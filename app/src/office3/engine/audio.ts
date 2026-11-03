export class OfficeAudio {
  private context: AudioContext | null = null;
  private enabled = true;
  private volume = 0.7;
  private interactionVolume = 1;
  private doorVolume = 1;
  private notificationsEnabled = true;
  private doNotDisturb = false;
  private ambience: "none" | "focus" | "social" | "meeting" = "none";
  private ambienceOscillator: OscillatorNode | null = null;
  private ambienceGain: GainNode | null = null;
  private readonly activeCues = new Set<AudioScheduledSourceNode>();
  private noticeSample: AudioBuffer | null = null;
  private noticeSampleLoading: Promise<void> | null = null;
  private blurred = document.hidden;
  private readonly onBlur = () => { this.blurred = true; this.context?.suspend().catch(() => undefined); };
  private readonly onFocus = () => { this.blurred = document.hidden; };
  constructor() { window.addEventListener("blur", this.onBlur); window.addEventListener("focus", this.onFocus); document.addEventListener("visibilitychange", this.onFocus); }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.stopAmbience(); else this.applyAmbience(); if (!enabled) this.context?.suspend().catch(() => undefined); }
  setVolume(volume: number): void { this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.7)); this.applyAmbience(); }
  setCategoryVolumes(interaction: number, door: number): void { this.interactionVolume = Math.max(0, Math.min(1, Number.isFinite(interaction) ? interaction : 1)); this.doorVolume = Math.max(0, Math.min(1, Number.isFinite(door) ? door : 1)); }
  setNoticePreferences(notificationsEnabled: boolean, doNotDisturb: boolean): void { this.notificationsEnabled = notificationsEnabled; this.doNotDisturb = doNotDisturb; }
  unlock(): void { if (!this.enabled || this.blurred) return; this.context ??= new AudioContext(); void this.context.resume().then(() => this.applyAmbience()).catch(() => undefined); void this.loadNoticeSample(); }
  setAmbience(ambience: "none" | "focus" | "social" | "meeting"): void { if (this.ambience === ambience) return; this.ambience = ambience; this.applyAmbience(); }
  private stopAmbience(): void { if (!this.ambienceOscillator || !this.ambienceGain || !this.context) return; const oscillator = this.ambienceOscillator, gain = this.ambienceGain, now = this.context.currentTime; gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(.0001, now + .18); oscillator.stop(now + .2); this.ambienceOscillator = null; this.ambienceGain = null; }
  private applyAmbience(): void { this.stopAmbience(); if (!this.enabled || this.blurred || this.ambience === "none" || !this.context || this.context.state !== "running") return; const oscillator = this.context.createOscillator(), gain = this.context.createGain(), now = this.context.currentTime, frequency = this.ambience === "focus" ? 112 : this.ambience === "social" ? 148 : 98; oscillator.type = this.ambience === "meeting" ? "triangle" : "sine"; oscillator.frequency.setValueAtTime(frequency, now); gain.gain.setValueAtTime(.0001, now); gain.gain.linearRampToValueAtTime(.006 * this.volume, now + .3); oscillator.connect(gain).connect(this.context.destination); oscillator.start(now); this.ambienceOscillator = oscillator; this.ambienceGain = gain; }
  private pan(source?: { x: number; z: number }, listener?: { x: number; z: number }): number {
    if (!source || !listener) return 0;
    return Math.max(-1, Math.min(1, (source.x - listener.x) / 8));
  }
  private tone(frequency: number, duration: number, volume: number, pan = 0): void {
    if (!this.enabled || this.blurred || !this.context || this.context.state !== "running") return;
    if (this.activeCues.size >= 8) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain(), now = this.context.currentTime;
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency, now); gain.gain.setValueAtTime(volume * this.volume, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    if (typeof this.context.createStereoPanner === "function") { const panner = this.context.createStereoPanner(); panner.pan.setValueAtTime(pan, now); oscillator.connect(gain).connect(panner).connect(this.context.destination); } else oscillator.connect(gain).connect(this.context.destination);
    this.activeCues.add(oscillator);
    oscillator.addEventListener("ended", () => this.activeCues.delete(oscillator), { once: true });
    oscillator.start(now); oscillator.stop(now + duration);
  }
  private loadNoticeSample(): Promise<void> {
    if (this.noticeSample) return Promise.resolve();
    if (this.noticeSampleLoading) return this.noticeSampleLoading;
    this.noticeSampleLoading = fetch("/office3/audio/new-message.mp3")
      .then(response => response.ok ? response.arrayBuffer() : Promise.reject())
      .then(bytes => this.context?.decodeAudioData(bytes))
      .then(sample => { this.noticeSample = sample ?? null; })
      .catch(() => undefined)
      .finally(() => { this.noticeSampleLoading = null; });
    return this.noticeSampleLoading;
  }
  private playNoticeSample(): boolean {
    if (!this.enabled || this.blurred || !this.context || this.context.state !== "running" || !this.noticeSample || this.activeCues.size >= 8) return false;
    const source = this.context.createBufferSource(), gain = this.context.createGain(), now = this.context.currentTime;
    source.buffer = this.noticeSample; gain.gain.setValueAtTime(.028 * this.volume, now); source.connect(gain).connect(this.context.destination); this.activeCues.add(source);
    source.addEventListener("ended", () => this.activeCues.delete(source), { once: true }); source.start(now); source.stop(now + Math.min(this.noticeSample.duration, .45));
    return true;
  }
  interaction(kind: string, source?: { x: number; z: number }, listener?: { x: number; z: number }): void { this.tone(kind === "coffee" ? 660 : kind === "printer" ? 220 : 440, .09, .035 * this.interactionVolume, this.pan(source, listener)); }
  door(open: boolean): void { this.tone(open ? 310 : 220, .07, .025 * this.doorVolume); }
  footstep(surface: string): void { this.tone(surface.includes("carpet") ? 155 : surface.includes("tile") || surface === "stone" ? 235 : 190, .045, .018 * this.interactionVolume); }
  emote(kind: string, source?: { x: number; z: number }, listener?: { x: number; z: number }): void { this.tone(kind === "celebrate" ? 784 : kind === "wave" ? 660 : kind === "think" ? 330 : 494, .075, .022 * this.interactionVolume, this.pan(source, listener)); }
  notice(priority: "info" | "success" | "warning" | "error" = "info"): void {
    if (priority !== "error" && (!this.notificationsEnabled || this.doNotDisturb)) return;
    if (!this.playNoticeSample()) { void this.loadNoticeSample(); this.tone(priority === "error" ? 196 : priority === "warning" ? 294 : priority === "success" ? 660 : 494, .065, .012); }
  }
  dispose(): void { window.removeEventListener("blur", this.onBlur); window.removeEventListener("focus", this.onFocus); document.removeEventListener("visibilitychange", this.onFocus); this.stopAmbience(); for (const cue of this.activeCues) { try { cue.stop(); } catch { /* already stopped */ } } this.activeCues.clear(); void this.context?.close(); this.context = null; }
}

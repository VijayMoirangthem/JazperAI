/** Speaks sentences one after another with minimal gap: the next sentence's audio is requested while the current one plays.
 *  stop() is the barge-in: it halts playback immediately and drops everything queued. */
export class Speaker {
  private queue: { text: string; audio: HTMLAudioElement }[] = [];
  private current: HTMLAudioElement | null = null;
  private generation = 0;
  private playing = false;
  /** called with the time (ms since epoch) when the first sound of an utterance starts */
  onFirstAudio?: (t: number) => void;
  onIdle?: () => void;
  private firstReported = false;

  constructor(private readonly url: (text: string) => string, private readonly lookahead = 2) {}

  speak(text: string): void {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = this.url(text); // progressive MP3 stream from the backend; loading starts immediately
    this.queue.push({ text, audio });
    this.pump();
  }

  get active(): boolean { return this.playing || this.queue.length > 0; }

  stop(): void {
    this.generation++;
    this.queue.forEach((q) => { q.audio.src = ""; });
    this.queue = [];
    if (this.current) { this.current.pause(); this.current.src = ""; this.current = null; }
    this.playing = false;
    this.firstReported = false;
  }

  private pump(): void {
    // preload the lookahead items
    this.queue.slice(0, this.lookahead).forEach((q) => q.audio.load());
    if (this.playing || this.queue.length === 0) return;
    const gen = this.generation;
    const { audio } = this.queue.shift()!;
    this.current = audio;
    this.playing = true;
    const done = () => {
      if (gen !== this.generation) return;
      this.playing = false;
      this.current = null;
      if (this.queue.length) this.pump();
      else { this.firstReported = false; this.onIdle?.(); }
    };
    audio.onended = done;
    audio.onerror = done;
    audio.onplaying = () => { if (!this.firstReported) { this.firstReported = true; this.onFirstAudio?.(Date.now()); } };
    audio.play().catch(done);
  }
}

/**
 * Decides when you have finished speaking, from the microphone level (0..1, the same value that drives the waveform).
 *
 * It waits for speech to start, then for a pause long enough to be the end of a sentence. If nobody speaks at all it gives up after a while
 * (so a hands-free conversation does not keep the microphone open for ever), and a recording never runs longer than a hard limit.
 */
export type SilenceVerdict = 'listening' | 'stop-silence' | 'stop-no-speech' | 'stop-max';

export interface SilenceOptions {
  /** Level (0..1) above which something counts as speech. About -38 dB with the app's -55..0 dB scale. */
  speechLevel: number;
  /** Quiet time after speech that ends the recording. */
  silenceMs: number;
  /** Speech must last this long to count (a click or a cough does not). */
  minSpeechMs: number;
  /** Give up if no speech starts within this time. */
  noSpeechMs: number;
  /** Hard limit for one recording. */
  maxMs: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { speechLevel: 0.3, silenceMs: 1300, minSpeechMs: 350, noSpeechMs: 8000, maxMs: 60_000 };

export class SilenceDetector {
  private readonly opt: SilenceOptions;
  private startedAt: number | null = null;
  private speechSince: number | null = null; // when the current stretch of loud samples began
  private spokeFor = 0; // total confirmed speech time
  private lastLoud: number | null = null;
  private confirmed = false;

  constructor(options: Partial<SilenceOptions> = {}) {
    this.opt = { ...DEFAULT_SILENCE, ...options };
  }

  /** Call for every meter sample. `now` in milliseconds. */
  update(level: number, now: number): SilenceVerdict {
    if (this.startedAt === null) this.startedAt = now;
    if (now - this.startedAt >= this.opt.maxMs) return 'stop-max';

    if (level >= this.opt.speechLevel) {
      if (this.speechSince === null) this.speechSince = now;
      this.lastLoud = now;
      if (!this.confirmed && now - this.speechSince >= this.opt.minSpeechMs) this.confirmed = true;
    } else if (this.speechSince !== null) {
      if (this.confirmed) this.spokeFor += (this.lastLoud ?? now) - this.speechSince;
      this.speechSince = null;
    }

    if (!this.confirmed) {
      return now - this.startedAt >= this.opt.noSpeechMs ? 'stop-no-speech' : 'listening';
    }
    return this.lastLoud !== null && now - this.lastLoud >= this.opt.silenceMs ? 'stop-silence' : 'listening';
  }

  /** True once real speech (not just noise) has been heard. */
  get heardSpeech(): boolean {
    return this.confirmed;
  }
}

/**
 * Speaks chunks of text one after another with no gaps: while chunk N is playing, chunk N+1 (and N+2) are already being downloaded.
 * Chunks can arrive while it is playing (a reply that is still being written): push() them as they complete, close() at the end.
 *
 * Pure logic with injected `fetch`/`play`/`discard`, so it is tested without a phone. `done` resolves when everything was spoken (or it was
 * stopped) and rejects if a download or playback fails.
 */
export interface PipelineDeps<F> {
  /** Download the audio for one chunk. */
  fetch: (text: string) => Promise<F>;
  /** Play it; `onStart` is called when sound begins. Resolves when it has finished OR when `signal.stopped` resolves (the pipeline was stopped: end the sound now). */
  play: (file: F, onStart: () => void, signal: { stopped: Promise<void> }) => Promise<void>;
  /** Clean up a downloaded file (played, or never played because of a stop). */
  discard: (file: F) => void;
  /** First sound of this pipeline began (once). */
  onFirstSound?: () => void;
}

interface Item<F> {
  text: string;
  file?: Promise<F>;
}

export class SpeechPipeline<F> {
  readonly done: Promise<void>;
  private items: Item<F>[] = [];
  private started = 0; // items whose download has begun
  private played = 0; // items that have been handed to the player
  private closed = false;
  private stopped = false;
  private wake: (() => void) | null = null;
  private firstSound = false;
  private stopResolve: (() => void) | null = null;
  private readonly stoppedPromise = new Promise<void>((resolve) => {
    this.stopResolve = resolve;
  });

  constructor(
    private readonly deps: PipelineDeps<F>,
    private readonly ahead = 2
  ) {
    this.done = this.loop();
  }

  push(text: string): void {
    if (this.closed || this.stopped || !text.trim()) return;
    this.items.push({ text });
    this.pump();
    this.signal();
  }

  /** No more text is coming. */
  close(): void {
    this.closed = true;
    this.signal();
  }

  /** Abandon everything now (the user pressed Stop, or sent a new message). */
  stop(): void {
    this.stopped = true;
    this.closed = true;
    this.stopResolve?.();
    this.signal();
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  private signal(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  /** Start downloading ahead of the player, but never more than `ahead` chunks beyond the one playing. */
  private pump(): void {
    while (!this.stopped && this.started < this.items.length && this.started - this.played < this.ahead) {
      const item = this.items[this.started];
      item.file = this.deps.fetch(item.text);
      item.file.catch(() => undefined); // the player loop below reports the error; this only avoids an unhandled rejection
      this.started += 1;
    }
  }

  private async loop(): Promise<void> {
    try {
      for (;;) {
        if (this.stopped) break;
        if (this.played >= this.items.length) {
          if (this.closed) break;
          await new Promise<void>((resolve) => {
            this.wake = resolve;
          });
          continue;
        }
        this.pump();
        const item = this.items[this.played];
        const file = await (item.file as Promise<F>);
        this.played += 1;
        if (this.stopped) {
          this.deps.discard(file);
          break;
        }
        this.pump(); // start the next download while this one plays
        try {
          await this.deps.play(
            file,
            () => {
              if (!this.firstSound) {
                this.firstSound = true;
                this.deps.onFirstSound?.();
              }
            },
            { stopped: this.stoppedPromise }
          );
        } finally {
          this.deps.discard(file);
        }
      }
    } catch (err) {
      this.stopped = true;
      throw err;
    } finally {
      this.stopped = true;
      // Anything downloaded but never played is thrown away.
      for (let i = this.played; i < this.items.length; i += 1) {
        this.items[i].file?.then((f) => this.deps.discard(f)).catch(() => undefined);
      }
    }
  }
}

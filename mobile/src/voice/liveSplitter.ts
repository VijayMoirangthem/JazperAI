/**
 * Speaking a reply while it is still being written: hands out complete sentences as the text grows, so the first words are spoken
 * about a second after the model starts instead of after it finishes.
 *
 * A sentence end counts only when it is followed by a space or a new line (so "3.5" or "e.g." in the middle of a stream is not cut), and
 * very short pieces are merged into the next one so the voice does not speak in fragments.
 */
export class LiveSplitter {
  private spoken = 0; // characters of the text already handed out
  private first = true;

  constructor(
    private readonly minFirst = 40,
    private readonly min = 30
  ) {}

  /** New chunks that became complete since the last call. `text` is the whole reply so far. */
  push(text: string): string[] {
    const out: string[] = [];
    // Several chunks may be ready at once (a fast model): keep cutting until nothing complete is left.
    for (;;) {
      const rest = text.slice(this.spoken);
      const cut = this.cutPoint(rest);
      if (cut <= 0) break;
      const chunk = clean(rest.slice(0, cut));
      this.spoken += cut;
      if (chunk) {
        out.push(chunk);
        this.first = false;
      }
    }
    return out;
  }

  /** The reply is finished: whatever is left is spoken too. */
  flush(text: string): string[] {
    const rest = clean(text.slice(this.spoken));
    this.spoken = text.length;
    return rest ? [rest] : [];
  }

  reset(): void {
    this.spoken = 0;
    this.first = true;
  }

  // End of the chunk to cut from `rest`: the FIRST chunk ends at the first sentence end that makes it long enough (fast start); later
  // chunks take everything complete so far (fewer requests).
  private cutPoint(rest: string): number {
    const need = this.first ? this.minFirst : this.min;
    const re = /[.!?।॥]+["')\]]*(?=\s)|\n+/g;
    let best = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
      const end = m.index + m[0].length;
      if (rest.slice(0, end).trim().length < need) continue;
      if (this.first) return this.withTrailingSpace(rest, end);
      best = end;
    }
    return best < 0 ? -1 : this.withTrailingSpace(rest, best);
  }

  private withTrailingSpace(rest: string, end: number): number {
    let e = end;
    while (e < rest.length && /\s/.test(rest[e])) e += 1;
    return e;
  }
}

/** Text as it should be SPOKEN: no markdown marks, code, links or emoji (they would be read out as symbols or silence). */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links with a label: keep the label (before bare URLs, which would eat the bracket)
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(s: string): string {
  return cleanForSpeech(s);
}

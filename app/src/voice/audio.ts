/** Splits streamed text into speakable sentences and encodes microphone audio; pure helpers (unit-tested). */

const BOUNDARY = /[.!?…]+["')\]]*\s|\n/;

/** Incremental sentence splitter: feed deltas, get complete sentences as soon as the next whitespace proves they ended. */
export class SentenceSplitter {
  private buf = "";

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const m = BOUNDARY.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      const sentence = this.buf.slice(0, end).trim();
      this.buf = this.buf.slice(end);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** Remaining text at the end of the stream. */
  flush(): string {
    const rest = this.buf.trim();
    this.buf = "";
    return rest;
  }
}

/** Removes markdown/code noise that should not be read aloud. */
export function speakable(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " code omitted ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 16-bit PCM mono WAV from Float32 samples (what Silero VAD hands back, 16 kHz). */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

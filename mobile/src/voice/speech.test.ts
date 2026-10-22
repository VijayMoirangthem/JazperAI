import { DEFAULT_VOICE, JASPER_VOICE, MAX_SPEAK_CHARS, splitForSpeech, voiceForBot } from './speech';

describe('speech helpers', () => {
  it('uses the Jasper voice by default and Aria for other bots', () => {
    expect(voiceForBot('jasper')).toBe(JASPER_VOICE);
    expect(voiceForBot('nova')).toBe(DEFAULT_VOICE);
  });

  it('returns no chunks for empty text', () => {
    expect(splitForSpeech('   ')).toEqual([]);
  });

  it('keeps short sentences together', () => {
    expect(splitForSpeech('Hello there. How are you?')).toEqual(['Hello there. How are you?']);
  });

  it('splits sentences that exceed the limit', () => {
    const long = 'word '.repeat(700).trim();
    const chunks = splitForSpeech(long, MAX_SPEAK_CHARS);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX_SPEAK_CHARS)).toBe(true);
  });

  it('packs sentences up to the limit', () => {
    const sentence = `${'a'.repeat(700)}.`;
    const chunks = splitForSpeech(`${sentence} ${sentence} ${sentence}`, MAX_SPEAK_CHARS);

    expect(chunks.length).toBe(2);
    expect(chunks.every((chunk) => chunk.length <= MAX_SPEAK_CHARS)).toBe(true);
  });

  it('never returns a chunk above the maximum', () => {
    const chunks = splitForSpeech(`${'x'.repeat(4000)} tail`, MAX_SPEAK_CHARS);
    expect(chunks.every((chunk) => chunk.length <= MAX_SPEAK_CHARS)).toBe(true);
    expect(chunks.join(' ').includes('tail')).toBe(true);
  });
});

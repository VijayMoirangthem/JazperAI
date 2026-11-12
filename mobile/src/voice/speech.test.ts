import { detectSpokenLanguage, voiceForText, HINDI_VOICE_MALE, HINGLISH_VOICE_MALE, HINGLISH_VOICE_FEMALE, DEFAULT_VOICE, JASPER_VOICE, MAX_SPEAK_CHARS, splitForSpeech, voiceForBot } from './speech';

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

describe('spoken language voices', () => {
  it('detects English, Hindi and Hinglish', () => {
    expect(detectSpokenLanguage('All good. Connected: google-workspace.')).toBe('english');
    expect(detectSpokenLanguage('आज का दिन अच्छा चल रहा है।')).toBe('hindi');
    expect(detectSpokenLanguage('Aaj ka din smooth chal raha hai, sab theek se manage ho raha hai.')).toBe('hinglish');
    expect(detectSpokenLanguage('12:30 ???')).toBe('english');
  });

  it('picks a matching voice per language and bot', () => {
    expect(voiceForText('jasper', 'आज का दिन अच्छा है')).toBe(HINDI_VOICE_MALE);
    expect(voiceForText('jasper', 'Aaj ka din bahut accha hai')).toBe(HINGLISH_VOICE_MALE);
    expect(voiceForText('nova', 'Aaj ka din bahut accha hai')).toBe(HINGLISH_VOICE_FEMALE);
    expect(voiceForText('nova', 'Everything is fine')).toBe(DEFAULT_VOICE);
  });

  it('splits Hindi sentences on the danda', () => {
    expect(splitForSpeech('पहला वाक्य। दूसरा वाक्य।', 12).length).toBe(2);
  });
});

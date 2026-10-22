export const MAX_SPEAK_CHARS = 1_500;
export const DEFAULT_VOICE = 'en-US-AriaNeural';
export const JASPER_VOICE = 'en-GB-RyanNeural';

export function voiceForBot(slug: string): string {
  return slug === 'jasper' ? JASPER_VOICE : DEFAULT_VOICE;
}

export function splitForSpeech(text: string, max = MAX_SPEAK_CHARS): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?]+[.!?]*/g) ?? [normalized];
  const chunks: string[] = [];
  let current = '';

  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const raw of sentences) {
    let sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length > max) {
      push(current);
      current = '';
      while (sentence.length > max) {
        let cut = sentence.lastIndexOf(' ', max);
        if (cut <= 0) cut = max;
        push(sentence.slice(0, cut));
        sentence = sentence.slice(cut).trim();
      }
      if (sentence) current = sentence;
    } else if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= max) {
      current = `${current} ${sentence}`;
    } else {
      push(current);
      current = sentence;
    }
  }

  push(current);
  return chunks;
}

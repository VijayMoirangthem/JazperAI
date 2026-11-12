export const MAX_SPEAK_CHARS = 1_500;
export const DEFAULT_VOICE = 'en-US-AriaNeural';
export const JASPER_VOICE = 'en-GB-RyanNeural';

// Spoken languages. Hindi text (Devanagari) gets a Hindi neural voice. Hinglish (Hindi in Roman letters) is read best by an
// Indian-English voice (a Hindi voice spells Roman words letter by letter). English keeps the usual voice.
export const HINDI_VOICE_MALE = 'hi-IN-MadhurNeural';
export const HINDI_VOICE_FEMALE = 'hi-IN-SwaraNeural';
export const HINGLISH_VOICE_MALE = 'en-IN-PrabhatNeural';
export const HINGLISH_VOICE_FEMALE = 'en-IN-NeerjaNeural';

const HINGLISH_WORDS = new Set(
  (
    'hai hain hoon tha thi kya kyun kaise kaisa kaisi kahan kab kaun kitna mujhe mera meri mere tum tumhe aap aapka aapko hum ' +
    'humein yeh ye woh wo nahi nahin haan ji bhai yaar karo kar karna kare karein kiya kijiye batao bata bataiye bolo dikha ' +
    'dikhao dekho suno chalo raha rahi rahe hoga hogi hua hui hue sakta sakti chahiye aaj kal abhi phir bahut bohot thoda zyada ' +
    'kuch koi toh bhi se ko ka ki ke par pe mein saath liye lekin aur agar kyunki isliye matlab accha theek sahi kaam din raat ' +
    'subah shaam paisa ghar log mil diya dena lena'
  ).split(' ')
);

export type SpokenLanguage = 'english' | 'hindi' | 'hinglish';

export function detectSpokenLanguage(text: string): SpokenLanguage {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 'english';
  const deva = text.match(/[ऀ-ॿ]/g) ?? [];
  if (deva.length / letters.length > 0.25) return 'hindi';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter((w) => HINGLISH_WORDS.has(w)).length;
  return hits >= 2 && hits / Math.max(words.length, 1) >= 0.15 ? 'hinglish' : 'english';
}

export function voiceForBot(slug: string): string {
  return slug === 'jasper' ? JASPER_VOICE : DEFAULT_VOICE;
}

/** The voice for one reply: the bot's own voice for English, a Hindi / Indian-English voice when the reply is Hindi / Hinglish. */
export function voiceForText(slug: string, text: string): string {
  const male = slug === 'jasper';
  switch (detectSpokenLanguage(text)) {
    case 'hindi':
      return male ? HINDI_VOICE_MALE : HINDI_VOICE_FEMALE;
    case 'hinglish':
      return male ? HINGLISH_VOICE_MALE : HINGLISH_VOICE_FEMALE;
    default:
      return voiceForBot(slug);
  }
}

export function splitForSpeech(text: string, max = MAX_SPEAK_CHARS): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized.match(/[^.!?।]+[.!?।]*/g) ?? [normalized];
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

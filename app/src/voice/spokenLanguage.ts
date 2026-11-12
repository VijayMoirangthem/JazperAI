// Picks the spoken voice from the language of the text, so Hindi and Hinglish replies are not read in an English voice.
// Hindi in Devanagari -> a Hindi neural voice. Hinglish (Hindi in Roman letters) -> an Indian-English voice (a Hindi voice would spell
// the Roman words letter by letter). English keeps the voice the user chose for that bot. Same rules as the phone app.
export type SpokenLanguage = "english" | "hindi" | "hinglish";

const HINGLISH_WORDS = new Set(
  (
    "hai hain hoon tha thi kya kyun kaise kaisa kaisi kahan kab kaun kitna mujhe mera meri mere tum tumhe aap aapka aapko hum " +
    "humein yeh ye woh wo nahi nahin haan ji bhai yaar karo kar karna kare karein kiya kijiye batao bata bataiye bolo dikha " +
    "dikhao dekho suno chalo raha rahi rahe hoga hogi hua hui hue sakta sakti chahiye aaj kal abhi phir bahut bohot thoda zyada " +
    "kuch koi toh bhi se ko ka ki ke par pe mein saath liye lekin aur agar kyunki isliye matlab accha theek sahi kaam din raat " +
    "subah shaam paisa ghar log mil diya dena lena"
  ).split(" "),
);

export function detectSpokenLanguage(text: string): SpokenLanguage {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return "english";
  const deva = text.match(/[ऀ-ॿ]/g) ?? [];
  if (deva.length / letters.length > 0.25) return "hindi";
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter((w) => HINGLISH_WORDS.has(w)).length;
  return hits >= 2 && hits / Math.max(words.length, 1) >= 0.15 ? "hinglish" : "english";
}

const MALE = /(Ryan|Guy|Christopher|Eric|Roger|Steffan|Andrew|Brian|Davis|Jason|Tony|Thomas|Mitchell|Prabhat|Madhur|Connor|Liam|William|Ethan|Noah|Sam)Neural$/;

/** The voice to use for `text`, given the voice chosen for the bot (used as is for English, and to keep male/female for the others). */
export function voiceForText(chosen: string, text: string): string {
  const male = MALE.test(chosen);
  switch (detectSpokenLanguage(text)) {
    case "hindi":
      return male ? "hi-IN-MadhurNeural" : "hi-IN-SwaraNeural";
    case "hinglish":
      return male ? "en-IN-PrabhatNeural" : "en-IN-NeerjaNeural";
    default:
      return chosen;
  }
}

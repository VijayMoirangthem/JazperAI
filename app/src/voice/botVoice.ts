import { create } from "zustand";
import { SentenceSplitter, speakable } from "./audio";
import { Speaker } from "./speaker";

// Reads text aloud in a chosen Edge neural voice (free, streamed from the local backend). TTS never touches the LLM, so it costs no tokens.
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
let voice = "en-US-AriaNeural";
const speaker = new Speaker((t) => `${API}/api/v1/voice2/speak?text=${encodeURIComponent(t)}&voice=${encodeURIComponent(voice)}`);
export const useTts = create<{ speaking: boolean; who: string }>(() => ({ speaking: false, who: "" }));
speaker.onIdle = () => useTts.setState({ speaking: false, who: "" });

export function speakAs(slug: string, voiceName: string, text: string): void {
  speaker.stop();
  voice = voiceName;
  const splitter = new SentenceSplitter();
  const parts = [...splitter.push(text), splitter.flush()].map(speakable).filter(Boolean);
  if (!parts.length) return;
  useTts.setState({ speaking: true, who: slug });
  parts.forEach((p) => speaker.speak(p));
}
export function stopSpeaking(): void { speaker.stop(); useTts.setState({ speaking: false, who: "" }); }

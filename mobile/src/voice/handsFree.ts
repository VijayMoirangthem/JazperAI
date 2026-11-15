/**
 * Hands-free voice conversation: when should the microphone open by itself?
 *
 * Only when it is Jasper's turn to be finished: nothing is being written or spoken, you are not already recording or waiting for a
 * transcript, and you have not paused the conversation (a stretch of silence, or you pressed stop).
 */
export interface HandsFreeState {
  handsFree: boolean;
  /** The reply is still being written. */
  streaming: boolean;
  /** Jasper is speaking (or about to). */
  speaking: boolean;
  recording: boolean;
  transcribing: boolean;
  /** The conversation was paused (nobody spoke for a while, or you stopped it). A tap on the mic resumes it. */
  paused: boolean;
  /** The screen is in front of the user. */
  focused: boolean;
}

export function shouldListen(s: HandsFreeState): boolean {
  return s.handsFree && s.focused && !s.paused && !s.streaming && !s.speaking && !s.recording && !s.transcribing;
}

/** Delay before opening the microphone, so the speaker has really stopped (it would otherwise hear the end of its own voice). */
export const LISTEN_DELAY_MS = 700;

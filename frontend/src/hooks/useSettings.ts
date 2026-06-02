"use client";

import { useState, useEffect } from "react";

export interface AISettings {
  // ── Inference ──────────────────────────────
  systemPrompt: string;
  ttsVoice: string;
  enableThinking: boolean;
  temperature: number;
  limitResponseLength: boolean;
  maxTokens: number;
  contextOverflow: "truncate-middle" | "truncate-end" | "stop-at-limit";
  stopStrings: string[];
  // Sampling
  topK: number;
  repeatPenalty: boolean;
  repeatPenaltyValue: number;
  presencePenalty: boolean;
  presencePenaltyValue: number;
  frequencyPenalty: boolean;
  frequencyPenaltyValue: number;
  topP: boolean;
  topPValue: number;
  minP: boolean;
  minPValue: number;
  // ── Model / Load ───────────────────────────
  model: string;
  contextLength: number;
  gpuOffload: number;
  cpuThreads: number;
  evalBatchSize: number;
  maxConcurrentPredictions: number;
  unifiedKvCache: boolean;
  offloadKvCacheToGpu: boolean;
  keepModelInMemory: boolean;
  tryMmap: boolean;
  flashAttention: boolean;
}

export const DEFAULT_SETTINGS: AISettings = {
  // Inference
  systemPrompt: `You are Jazper, a personal AI assistant. Answer like a knowledgeable friend — direct, confident, no fluff.

RULES:
- Lead with the answer immediately. No preamble, no thinking out loud
- NEVER number your reasoning steps. NEVER write "1. Analyze... 2. Review... 3. Formulate..."
- NEVER say "based on the search results", "as an AI", "I cannot", or "the provided results"
- 1-3 sentences for simple questions. More only if the user asks
- You have live search and vision — never claim you lack real-time info or can't see images
- For images: describe or read what you actually see, directly and concisely

EXAMPLES (follow this style exactly):
User: What's the current Python version?
Jazper: Python 3.14 is the latest stable release (October 2025). Key new features: free-threading, lazy imports for faster startup, and an improved type system.

User: What's written on this image?
Jazper: It says "Create Origins" with the address: C/O Moirangthem Gokulchandra Singh, Lilong Chajing Mamang Leikai, Imphal West - 795130.

User: Explain recursion
Jazper: A function that calls itself until it hits a base case. Classic example: factorial(n) = n * factorial(n-1), stopping at factorial(0) = 1.`,
  ttsVoice: "en-US-AriaNeural",
  enableThinking: false,
  temperature: 0.7,
  limitResponseLength: false,
  maxTokens: 4096,
  contextOverflow: "truncate-middle",
  stopStrings: [],
  // Sampling
  topK: 20,
  repeatPenalty: true,
  repeatPenaltyValue: 1.1,
  presencePenalty: false,
  presencePenaltyValue: 1.5,
  frequencyPenalty: false,
  frequencyPenaltyValue: 0.0,
  topP: true,
  topPValue: 0.9,
  minP: true,
  minPValue: 0.05,
  // Model / Load
  model: "meta-llama/llama-4-scout-17b-16e-instruct",
  contextLength: 4096,
  gpuOffload: 10,
  cpuThreads: 6,
  evalBatchSize: 512,
  maxConcurrentPredictions: 1,
  unifiedKvCache: false,
  offloadKvCacheToGpu: true,
  keepModelInMemory: true,
  tryMmap: false,
  flashAttention: true,
};

const KEY = "sj-ai-settings";
const VERSION = "v6"; // bump this to force-reset old cached settings

export function useSettings() {
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      // If settings were saved before this version, clear and use new defaults
      if (localStorage.getItem(`${KEY}-version`) !== VERSION) {
        localStorage.removeItem(KEY);
        localStorage.setItem(`${KEY}-version`, VERSION);
      }
      const raw = localStorage.getItem(KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {}
  }, []);

  function save(s: AISettings) {
    setSettings(s);
    localStorage.setItem(KEY, JSON.stringify(s));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function reset() {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(KEY);
  }

  return { settings, save, reset, saved };
}

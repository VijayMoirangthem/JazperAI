"use client";

import { useState, useEffect } from "react";

const KEY = "sj-session-id";

export function useSession() {
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    setSessionId(id);
  }, []);

  function newSession() {
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    setSessionId(id);
    return id;
  }

  function switchSession(id: string) {
    localStorage.setItem(KEY, id);
    setSessionId(id);
  }

  return { sessionId, newSession, switchSession };
}

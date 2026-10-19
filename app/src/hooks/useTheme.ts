"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("sj-theme") as Theme | null;
    if (stored) apply(stored);
  }, []);

  function apply(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("sj-theme", t);
    setTheme(t);
  }

  function toggle() {
    apply(theme === "dark" ? "light" : "dark");
  }

  return { theme, toggle, set: apply };
}

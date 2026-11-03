/** Device-local presentation locale; Office data and collaboration payloads stay language-neutral. */
import { loadOfficeViewSettings } from "../core/settings";
export const officeLocale = (): string | undefined => {
  const language = loadOfficeViewSettings().language;
  if (language === "Hindi") return "hi-IN";
  if (language === "English") return "en-IN";
  return undefined;
};

export const relativeOfficeTime = (value?: string, locale = officeLocale()) => {
  if (!value) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  const then = Date.parse(value);
  if (Number.isNaN(then)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 60) return formatter.format(-seconds, "second");
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), "hour");
  return formatter.format(-Math.floor(seconds / 86400), "day");
};

export const officeTime = (value: string, locale = officeLocale()) => new Date(value).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

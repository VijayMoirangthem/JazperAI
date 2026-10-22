export type QualityTier = "low" | "medium" | "high";
export const qualityForP95 = (p95Ms: number, current: QualityTier): QualityTier => {
  if (current === "high" && p95Ms > 22) return "medium";
  if (current === "medium" && p95Ms > 34) return "low";
  if (current === "low" && p95Ms < 24) return "medium";
  if (current === "medium" && p95Ms < 16) return "high";
  return current;
};
export const qualitySettings = (tier: QualityTier) => ({ pixelRatio: tier === "high" ? 2 : tier === "medium" ? 1.5 : 1, shadows: tier === "high", farAnimationHz: tier === "low" ? 10 : 20 });

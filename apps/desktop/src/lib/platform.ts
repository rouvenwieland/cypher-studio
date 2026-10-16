/** Plattformerkennung nur für Tastenkürzel-Beschriftung (Strg/⌘). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
}

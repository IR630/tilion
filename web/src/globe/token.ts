// HUD palette tokens (#94) for three.js and canvas: they cannot read var(--x), so read the computed
// value from :root once per scene. The fallback is the token value from styles.css, used where no
// stylesheet is loaded (tests, a token removed by mistake).

/** Computed CSS token value, e.g. the hex behind --sun. Accepts the name with or without "--". */
export function cssToken(name: string, fallback: string, el: Element | null = globalThis.document?.documentElement ?? null): string {
  if (!el || typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(el).getPropertyValue(name.startsWith("--") ? name : `--${name}`).trim();
  // An unresolved var() is not a colour for three.js; take the fallback.
  return v && !v.startsWith("var(") ? v : fallback;
}

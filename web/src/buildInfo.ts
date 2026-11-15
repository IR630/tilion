// Build stamp shown on the demo (#267). Values come from vite `define` (vite.config.ts).

/** "v<N> (<sha>), <date>"; "dev" when the build had no git. */
export function formatBuild(number: string, sha: string, date: string): string {
  return number === "dev" ? "dev" : `v${number} (${sha}), ${date}`;
}

/** "v<N>", or "dev" without git. */
export const buildTag = (number: string): string => (number === "dev" ? "dev" : `v${number}`);

export const BUILD_LABEL = formatBuild(__BUILD_NUMBER__, __BUILD_SHA__, __BUILD_DATE__);
export const BUILD_TAG = buildTag(__BUILD_NUMBER__);
export const BUILD_SHA = __BUILD_SHA__;

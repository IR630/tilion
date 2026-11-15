// #426: every deploy replaces the hashed chunks in assets/. A tab opened before the deploy
// asks for an old lazy chunk, Vite fires `vite:preloadError`, and the screen breaks.
// We reload the page once to get the new index.html. A mark in sessionStorage stops a loop:
// a second error within RELOAD_GAP_MS does not reload again. After the gap, a later deploy
// may reload the same tab once more.
export const RELOAD_KEY = "tilion:preload-reload";
export const RELOAD_GAP_MS = 5 * 60 * 1000;

export function installPreloadReload(
  target: Window = window,
  reload: () => void = () => target.location.reload(),
  now: () => number = Date.now,
): void {
  target.addEventListener("vite:preloadError", (event) => {
    let last: number;
    try {
      last = Number(target.sessionStorage.getItem(RELOAD_KEY) ?? 0);
      target.sessionStorage.setItem(RELOAD_KEY, String(now()));
    } catch {
      return; // no storage: no mark, so no reload (a loop is worse than one broken screen)
    }
    if (now() - last < RELOAD_GAP_MS) return; // already reloaded: let the error surface
    event.preventDefault();
    reload();
  });
}

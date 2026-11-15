import { afterEach, describe, expect, it, vi } from "vitest";
import { RELOAD_GAP_MS, RELOAD_KEY, installPreloadReload } from "./preloadReload";

const fire = () => window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));

describe("reload on a stale chunk after a deploy (#426)", () => {
  afterEach(() => sessionStorage.clear());

  it("reloads once on vite:preloadError, not on the second error", () => {
    const reload = vi.fn();
    let t = 1_800_000_000_000;
    installPreloadReload(window, reload, () => t);
    expect(fire()).toBe(false); // first error: default prevented, page reloads
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe(String(t));
    t += 1000;
    expect(fire()).toBe(true); // second error: no reload, the error surfaces
    expect(reload).toHaveBeenCalledTimes(1);
    t += RELOAD_GAP_MS; // a later deploy may reload the same tab again
    fire();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when sessionStorage throws", () => {
    const reload = vi.fn();
    const broken = Object.create(window, {
      sessionStorage: {
        get() {
          throw new Error("blocked");
        },
      },
    }) as Window;
    const listeners: EventListener[] = [];
    broken.addEventListener = ((_: string, fn: EventListener) => listeners.push(fn)) as Window["addEventListener"];
    installPreloadReload(broken, reload);
    listeners.forEach((fn) => fn(new Event("vite:preloadError", { cancelable: true })));
    expect(reload).not.toHaveBeenCalled();
  });
});

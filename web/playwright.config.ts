import { defineConfig } from "@playwright/test";

// e2e сценария демо: бэкенд отдаёт API и собранный фронтенд (make e2e делает build).
const PORT = Number(process.env.E2E_PORT ?? 8765);
// DEMO_VIDEO=1 make e2e — запасное видео демо (скилл /demo-video).
const size = { width: 1280, height: 720 };
const demoVideo = process.env.DEMO_VIDEO
  ? {
      viewport: size,
      video: { mode: "on" as const, size },
      launchOptions: { slowMo: 400 },
    }
  : {};

// Every spec is a returning visitor (#158): the welcome screen shows once, so the specs start in the
// navigator. hero.spec.ts clears this to test the first visit.
export const RETURNING = {
  cookies: [],
  origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: "tilion-entered", value: "1" }] }],
};

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${PORT}`, storageState: RETURNING, ...demoVideo },
  webServer: {
    command: `cd ../backend && uv run --frozen uvicorn api.main:app --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  // The load budgets (globe 5 s, terrain 3 s, map 2 s) run after the other specs: in parallel with
  // a dozen software-GL globe and map pages they measure CPU starvation, not the screen.
  // The budget specs run one at a time, last.
  projects: [
    { name: "app", testIgnore: /(globe|terrain3d|recorder|navigator)\.spec\.ts/ },
    { name: "3d", testMatch: /recorder\.spec\.ts/, dependencies: ["app"] },
    { name: "budget", testMatch: /(globe|terrain3d|navigator)\.spec\.ts/, dependencies: ["3d"], workers: 1 },
  ],
  // Every page starts on the WebGL globe (#72); on software GL a lazy chunk can take more than the
  // default 5 s to appear. Waits get 10 s; the budgets above are explicit Date.now() checks.
  expect: { timeout: 10_000 },
});

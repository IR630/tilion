import { execSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Build stamp (#267): commit count, short sha, commit date in UTC. No git: "dev". */
function buildStamp() {
  const git = (args: string) => execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    return {
      number: git("rev-list --count HEAD"),
      sha: git("rev-parse --short HEAD"),
      date: new Date(git("show -s --format=%cI HEAD")).toISOString().slice(0, 10),
    };
  } catch {
    return { number: "dev", sha: "dev", date: "dev" };
  }
}
const stamp = buildStamp();

export default defineConfig({
  base: "./", // static hosting (GitHub Pages) under any path
  plugins: [react()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(stamp.number),
    __BUILD_SHA__: JSON.stringify(stamp.sha),
    __BUILD_DATE__: JSON.stringify(stamp.date),
  },
  server: { proxy: { "/api": "http://localhost:8000" } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts?(x)"] },
});

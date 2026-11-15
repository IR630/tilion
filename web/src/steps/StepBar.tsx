import { useEffect, useState } from "react";
import { loadValidation } from "../api";

// #360: the user's path as numbered steps. Each step opens a
// view that already exists; the step lives in the URL hash (#step=<id>), so Back works.
export const STEPS = [
  { id: "site", label: "Site" },
  { id: "sky", label: "Sky" },
  { id: "windows", label: "Windows" },
  { id: "compare", label: "Compare" },
  { id: "mission", label: "Mission" },
  { id: "check", label: "NASA check" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export function stepFromHash(hash: string): StepId | null {
  const id = new URLSearchParams(hash.replace(/^#/, "")).get("step");
  return STEPS.some((s) => s.id === id) ? (id as StepId) : null;
}

// The proof for the NASA check step: how many of our numbers match the NASA references (validation.json).
export function useProof() {
  const [proof, setProof] = useState<{ pass: number; checks: number } | null>(null);
  useEffect(() => {
    let live = true;
    loadValidation().then((v) => live && v && setProof(v.summary), () => {});
    return () => {
      live = false;
    };
  }, []);
  return proof;
}

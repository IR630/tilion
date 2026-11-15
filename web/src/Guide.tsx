import { useEffect, useState } from "react";
import "./guide.css";

/** #382: the 1-minute tour from the hero shows each step this long, 6 steps in about 40 s. */
export const TOUR_STEP_MS = 8000;

const RIDGE = "cr1_connecting_ridge";
const HAWORTH = "a_haworth";
const JAN = "2027-01-15T00:00:00Z";
export type GuideStep = {
  screen: "compare" | "horizon" | "calendar" | "validation";
  site: string;
  time: string;
  title: string;
  text: string;
};
const STEPS: GuideStep[] = [
  { screen: "compare", site: RIDGE, time: JAN, title: "Light and shadow, side by side",
    text: "The ridge is sunlit while Haworth is in shadow. Compare power and Earth contact before choosing a landing site." },
  { screen: "horizon", site: RIDGE, time: JAN, title: "The Sun barely rises",
    text: "Near the south pole, the Sun stays low. The amber disc is the Sun. The shaded outline is the LOLA terrain horizon." },
  { screen: "horizon", site: HAWORTH, time: JAN, title: "Earth on the horizon",
    text: "The blue marker is Earth. Terrain can block direct communication. Read Earth visibility and the next rise or set below the panorama." },
  { screen: "calendar", site: RIDGE, time: "2027-03-15T00:00:00Z", title: "Find a landing window",
    text: "Each cell is one day. Light cells are days you can land. P and C mark days you cannot: P for power, C for comm. Red and blue bars show the Sun and Earth hours. Select a day to move the shared time." },
  { screen: "compare", site: RIDGE, time: "2027-03-22T00:00:00Z", title: "What if landing slips?",
    text: "This is one week later. Compare the sites again. Use the date-slip buttons to see how a delay changes power and contact." },
  { screen: "validation", site: RIDGE, time: JAN, title: "Check the evidence",
    text: "NASA check shows comparisons with JPL Horizons and published illumination. Read the measured spread and any failed checks before using the result." },
];

/** The guide is opt-in (#158): it never opens by itself on load, only with ?guide=1 (and never over
 *  a shared mission link) or from the Guide button in the rail. */
export function initialGuide(): boolean {
  const q = new URLSearchParams(window.location.search);
  if (q.has("site") || q.has("t")) return false;
  return q.get("guide") === "1";
}

export function Guide({ onStep, onClose, onPrediction, autoplay = false }: { onStep: (step: GuideStep) => void; onClose: () => void; onPrediction?: () => void; autoplay?: boolean }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  useEffect(() => onStep(step), [step, onStep]);
  // The tour moves on by itself until the visitor touches the page, then it stops for good (#382).
  useEffect(() => {
    if (!playing || last) return;
    const t = setTimeout(() => setIndex(index + 1), TOUR_STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, last]);
  useEffect(() => {
    if (!playing) return;
    const stop = () => setPlaying(false);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => document.addEventListener(e, stop, true));
    return () => events.forEach((e) => document.removeEventListener(e, stop, true));
  }, [playing]);
  return (
    <section className="guide" aria-label="How to read" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div aria-live="polite">
        <span className="guide-count">{index + 1} / {STEPS.length}</span>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
      </div>
      {playing && !last && (
        <div className="guide-progress" aria-hidden="true">
          <span key={index} style={{ animationDuration: `${TOUR_STEP_MS}ms` }} />
        </div>
      )}
      <div className="guide-actions">
        {last && onPrediction && <button type="button" onClick={onPrediction}>Try a prediction</button>}
        <button type="button" onClick={onClose} aria-label="Close guide">Close</button>
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button>
        <button type="button" onClick={() => last ? onClose() : setIndex(index + 1)}>
          {last ? "Done" : "Next"}
        </button>
      </div>
      {autoplay && !playing && !last && <p className="guide-paused">Tour paused. Use Next to continue.</p>}
    </section>
  );
}

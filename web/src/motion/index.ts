// #126 motion system (GSAP). Public API for the screens and for the navigator (#72).
import "./motion.css";

export { DUR, EASE, EASE_LINE, STAGGER, UI, gsap, motionOff, setMotion } from "./env";
export {
  bracketsIn,
  calloutOut,
  clearTemp,
  countUp,
  crossfade,
  drawLine,
  gridWave,
  overlayAt,
  removeWipes,
  reveal,
  scramble,
  screenWipe,
  sequence,
  shards,
  stamp,
  sweep,
} from "./primitives";
export { ITEMS, LABELS, NUMBERS, PANELS, hudCascade, timeOf, useBurst, useCrossfade, useFollowNumbers, useIntro, type IntroBuild } from "./hooks";
export { dataBurst, fragmentIn, hexTag, ribbon, screenDirection, whipIn } from "./fx";
export { countText, finishText, followText, scrambleText } from "./text";
export { CountUp, Scramble } from "./components";

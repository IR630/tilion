// #126 drop-in readouts for any screen (#72 navigator): a number that counts and follows its value,
// a mono caption that decodes on mount. Both render the final text; motion only rewrites it for a moment.
import { useLayoutEffect, useRef } from "react";
import { countText, followText, scrambleText } from "./text";

/** A readout whose numbers count up on mount and tween to each new value: <CountUp className="hud-value">{"214 h"}</CountUp>. */
export function CountUp({ children, className, duration }: { children: string | number; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!(node instanceof Text)) return;
    if (mounted.current) followText(node);
    else countText(node, { duration });
    mounted.current = true;
  });
  return (
    <span ref={ref} className={className}>
      {String(children)}
    </span>
  );
}

/** A mono caption that decodes from glyphs once, on mount (≤ 0.5 s). */
export function Scramble({ children, className, delay }: { children: string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (done.current || !(node instanceof Text)) return;
    done.current = true;
    scrambleText(node, { delay });
  });
  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
}

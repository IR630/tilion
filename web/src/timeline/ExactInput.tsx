// 24 h UTC text field "YYYY-MM-DD HH:MM" instead of the native datetime-local (AM/PM by locale, #113).
import { useEffect, useRef, useState } from "react";
import { fmtExact, isoUtc, parseExact, T0, T1 } from "./time";

/** Commits each valid hour as typed; marks bad text and restores the value on blur.
 *  autoFocus selects the text, so typing replaces it (#196); Enter calls onEnter. */
export function ExactInput(p: { label: string; valueUtc: string; onUtc: (utc: string) => void; autoFocus?: boolean; onEnter?: () => void }) {
  const [text, setText] = useState(() => fmtExact(p.valueUtc));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setText(fmtExact(p.valueUtc)), [p.valueUtc]);
  useEffect(() => {
    if (!p.autoFocus) return;
    ref.current?.focus();
    ref.current?.select();
  }, [p.autoFocus]);
  return (
    <input
      ref={ref}
      type="text"
      aria-label={p.label}
      placeholder="YYYY-MM-DD HH:MM"
      spellCheck={false}
      size={16}
      aria-invalid={parseExact(text) === null}
      title={`24 h UTC, ${fmtExact(isoUtc(T0))} … ${fmtExact(isoUtc(T1))}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const at = parseExact(e.target.value);
        if (at) p.onUtc(at);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && p.onEnter && parseExact(text)) {
          e.preventDefault();
          p.onEnter();
        }
      }}
      onBlur={() => setText(fmtExact(p.valueUtc))}
    />
  );
}

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CountUp,
  bracketsIn,
  dataBurst,
  fragmentIn,
  ribbon,
  whipIn,
  countText,
  crossfade,
  drawLine,
  finishText,
  followText,
  gridWave,
  motionOff,
  reveal,
  scrambleText,
  screenWipe,
  setMotion,
  stamp,
  useIntro,
} from ".";
import { formatNumbers, lerpText, parseNumbers, scrambleFrame } from "./text";

const text = (s: string) => {
  const el = document.createElement("span");
  el.textContent = s;
  document.body.appendChild(el);
  return el.firstChild as Text;
};

afterEach(() => {
  setMotion(null);
  document.body.innerHTML = "";
});

describe("number text", () => {
  it("finds readout numbers and keeps names, dates and times as text", () => {
    expect(parseNumbers("in 214 h (9 d)").values).toEqual([214, 9]);
    expect(parseNumbers("az 229.8° el +0.38°")).toMatchObject({ values: [229.8, 0.38], decimals: [1, 2], plus: [false, true] });
    expect(parseNumbers("Slip −7 d").values).toEqual([-7]);
    expect(parseNumbers("2027-01-15 00:00 UTC").values).toEqual([]);
    expect(parseNumbers("ridge (C1, 2 m) · DE440").values).toEqual([2]);
    expect(parseNumbers("spread 197–214 h").values).toEqual([197, 214]);
  });
  it("formats back exactly and interpolates with the target decimals and signs", () => {
    for (const s of ["az 229.8° el +0.38°", "el −1.25°", "52 % 40–61 %", "± 0.000001°", "no numbers"])
      expect(formatNumbers(parseNumbers(s), parseNumbers(s).values)).toBe(s);
    const to = parseNumbers("el +0.38°");
    expect(lerpText(parseNumbers("el −1.00°"), to, 0.5)).toBe("el −0.31°");
    expect(lerpText({ ...to, values: [0] }, to, 0)).toBe("el +0.00°");
  });
  it("decodes left to right and keeps spaces and the length", () => {
    const f = scrambleFrame("SUN AZ", 0.5, 3);
    expect(f).toHaveLength(6);
    expect(f.slice(0, 3)).toBe("SUN");
    expect(f[3]).toBe(" ");
    expect(scrambleFrame("SUN AZ", 1, 9)).toBe("SUN AZ");
  });
});

describe("motion off (prefers-reduced-motion, tests): final state at once", () => {
  it("is off under vitest and when the user asks for reduced motion", () => {
    expect(motionOff()).toBe(true);
  });
  it("every primitive returns null and leaves the DOM as rendered", () => {
    const host = document.createElement("section");
    host.innerHTML = `<div class="hud-frame">x</div><svg viewBox="0 0 10 10"><path d="M0,0L10,10"/></svg><b>PASS</b>`;
    document.body.appendChild(host);
    const before = host.innerHTML;
    const n = text("in 214 h");
    expect(reveal(host.children)).toBeNull();
    expect(bracketsIn(host.querySelector(".hud-frame"))).toBeNull();
    expect(drawLine(host.querySelectorAll("path"))).toBeNull();
    expect(screenWipe(host)).toBeNull();
    expect(stamp(host.querySelector("b"))).toBeNull();
    expect(gridWave([[host.children[0]]])).toBeNull();
    expect(crossfade(host.querySelector("path")!, "d", "M0,0L5,5")).toBeNull();
    expect(countText(n)).toBeNull();
    expect(scrambleText(n)).toBeNull();
    expect(whipIn(host)).toBeNull();
    expect(fragmentIn(host.children[0])).toBeNull();
    expect(dataBurst(host, ["LAT 89.44"])).toBeNull();
    expect(ribbon(host.querySelector("path"))).toBeNull();
    expect(host.innerHTML).toBe(before);
    expect(document.body.querySelectorAll(".motion-tmp")).toHaveLength(0);
    expect(n.nodeValue).toBe("in 214 h");
  });
  it("a changed value shows at once", () => {
    const n = text("12 h");
    followText(n);
    n.nodeValue = "20 h";
    followText(n);
    expect(n.nodeValue).toBe("20 h");
  });
  it("the screen intro hook leaves the rendered screen untouched", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    function Screen() {
      const ref = useRef<HTMLElement>(null);
      useIntro(ref, true);
      return (
        <section ref={ref} className="hud-screen">
          <span className="hud-label">Sunset</span>
          <span className="hud-value">in 214 h</span>
          <CountUp className="hud-value">{"52 %"}</CountUp>
        </section>
      );
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Screen />));
    expect(el.textContent).toBe("Sunsetin 214 h52 %");
    expect(el.querySelector("[style]")).toBeNull();
    expect(el.querySelector(".motion-wipe")).toBeNull();
    act(() => root.unmount());
  });
});

describe("motion on: every animation ends on the rendered state", () => {
  it("numbers count to the exact final text", () => {
    setMotion(true);
    const n = text("az 229.8° el +0.38°");
    const tw = countText(n)!;
    expect(n.nodeValue).toBe("az 0.0° el +0.00°");
    tw.progress(1);
    expect(n.nodeValue).toBe("az 229.8° el +0.38°");
  });
  it("a date, a time or a value never decodes from glyphs", () => {
    setMotion(true);
    for (const v of ["2027-01-15 00:00", "Sun elevation · ridge (C1, 2 m)", "030"]) {
      const n = text(v);
      expect(scrambleText(n)).toBeNull();
      expect(n.nodeValue).toBe(v);
    }
  });
  it("a caption decodes to its exact text, and finishText ends it early", () => {
    setMotion(true);
    const n = text("SUNSET");
    scrambleText(n, { duration: 0.4 });
    finishText();
    expect(n.nodeValue).toBe("SUNSET");
  });
  it("a new value glides from the shown one; React's next write wins", () => {
    setMotion(true);
    const n = text("12 h");
    followText(n);
    n.nodeValue = "20 h"; // React commit
    followText(n);
    expect(n.nodeValue).toBe("12 h");
    n.nodeValue = "30 h"; // the next commit before the glide ends
    followText(n);
    finishText();
    expect(n.nodeValue).toBe("30 h");
  });
  it("reveal and stamp clear their inline props at the end", () => {
    setMotion(true);
    const a = document.createElement("div");
    const b = document.createElement("b");
    document.body.append(a, b);
    const r = reveal(a)!;
    expect(a.style.opacity).toBe("0");
    r.progress(1);
    const s = stamp(b)!;
    s.progress(1);
    expect(a.getAttribute("style") ?? "").toBe("");
    expect(b.getAttribute("style") ?? "").toBe("");
  });
  it("the whip-pan clears its smear filter and transform", () => {
    setMotion(true);
    const host = document.createElement("section");
    document.body.appendChild(host);
    const w = whipIn(host, -1)!;
    expect(host.style.filter).toContain("motion-smear");
    w.progress(1);
    expect(host.style.filter).toBe("");
    expect(host.style.transform).toBe("");
  });
  it("the screen wipe removes itself", () => {
    setMotion(true);
    const host = document.createElement("section");
    document.body.appendChild(host);
    const w = screenWipe(host)!;
    expect(host.querySelector(".motion-wipe")).not.toBeNull();
    w.progress(1);
    expect(host.querySelector(".motion-wipe")).toBeNull();
  });
});

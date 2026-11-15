// "Model vs LRO image" card (#217): our terrain shadow over an LROC NAC image at its acquisition time.
// Data: data/lroc/index.json + <id>.json, written by backend precompute.lroc_check (D-017).
import { useEffect, useState } from "react";
import "./LrocCheck.css";

/** S9: photometric image shadow (Lommel-Seeliger on the LOLA slope) against the same model shadow. */
export interface LrocS9 {
  albedo: number;
  excludedPct: number;
  imageShadowPct: number;
  modelShadowPct: number;
  agreementPct: number;
  shadowIou: number;
  sphereAgreementPct: number;
  pass: boolean;
  reason: string;
  mask: string;
}

/** One LROC image compared with the model (data/lroc/<id>.json). */
export interface LrocResult {
  id: string;
  place: string;
  /** dev: S8 images, S9 tuned on them; test: S9 images fixed before download. */
  split?: "dev" | "test";
  s9?: LrocS9;
  images: string[];
  imageUrls: string[];
  orthoUrl: string;
  page: string;
  startUtc: string;
  stopUtc: string;
  midUtc: string;
  pixelM: number;
  cellM: number;
  bounds: [number, number, number, number];
  centre: { lonE: number; lat: number };
  sun: { az: number; el: number; radius: number };
  shiftM: [number, number];
  shiftCorrelation: number;
  cells: number;
  otsuIof: number;
  imageShadowPct: number;
  modelShadowPct: number;
  agreementPct: number;
  shadowIou: number;
  sphereAgreementPct: number;
  modelShadowDarkPct: number | null;
  minAgreementPct: number;
  minIou: number;
  pass: boolean;
  reason: string;
  image: string;
  mask: string;
  terrain: string;
}

interface LrocIndex {
  ids: string[];
  rule: string;
  rule9?: string;
}

const base = `${import.meta.env.BASE_URL}data/lroc/`;

async function getJson<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(base + name, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) console.error(`Failed to load ${base + name}`, r.status);
    return r.ok ? ((await r.json()) as T) : null;
  } catch (e) {
    console.error(`Failed to load ${base + name}`, e);
    return null;
  }
}

export async function loadLroc(): Promise<LrocResult[] | null> {
  const index = await getJson<LrocIndex>("index.json");
  if (!index) return null;
  const rows = await Promise.all(index.ids.map((id) => getJson<LrocResult>(`${id}.json`)));
  return rows.every((r) => r) ? (rows as LrocResult[]) : null;
}

type Method = "s9" | "s8";

function LrocCard({ r }: { r: LrocResult }) {
  const [opacity, setOpacity] = useState(0.6);
  const [method, setMethod] = useState<Method>(r.s9 ? "s9" : "s8");
  const s9 = method === "s9" && r.s9 ? r.s9 : null;
  const m = s9 ?? r;
  const split = r.split ?? "dev";
  return (
    <article className="val-card hud-frame lroc-card" aria-label={`LRO image: ${r.place}`}>
      <header>
        <h4>
          {r.place} <span className="lroc-split">{split === "test" ? "test (blind)" : "dev (tuning)"}</span>
        </h4>
        {m.pass ? <span className="val-pass">PASS</span> : <span className="val-fail">FAIL</span>}
      </header>
      <p className="val-site">
        NAC {r.images.join(" + ")}, {r.midUtc.slice(0, 19).replace("T", " ")} UTC, Sun {r.sun.el.toFixed(2)}° high, az{" "}
        {r.sun.az.toFixed(1)}°
      </p>
      {r.s9 && (
        <div className="lroc-methods" role="radiogroup" aria-label="Image shadow method">
          {(["s9", "s8"] as const).map((k) => (
            <label key={k}>
              <input type="radio" name={`m-${r.id}`} checked={method === k} onChange={() => setMethod(k)} />
              {k === "s9" ? "S9 photometry" : "S8 Otsu"} ({(k === "s9" ? r.s9?.pass : r.pass) ? "pass" : "fail"})
            </label>
          ))}
        </div>
      )}
      <div className="lroc-view">
        <img src={base + r.image} alt={`LROC NAC image of ${r.place}`} />
        <img src={base + (s9 ? s9.mask : r.mask)} alt="Model shadow overlay" className="lroc-mask" style={{ opacity }} />
      </div>
      <label className="lroc-slider">
        Overlay {Math.round(opacity * 100)} %
        <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
      </label>
      <p className="lroc-legend">
        <span className="lroc-both">■</span> shadow in both <span className="lroc-model">■</span> model only{" "}
        <span className="lroc-image">■</span> image only{s9 && <> <span className="lroc-out">■</span> not scored</>}. Clear cells:
        lit in both
      </p>
      <dl>
        <div className="val-big"><dt>Cell agreement</dt><dd>{m.agreementPct.toFixed(1)} %</dd></div>
        <div className="val-big"><dt>Shadow IoU</dt><dd>{m.shadowIou.toFixed(2)}</dd></div>
        <div>
          <dt>Pass needs</dt>
          <dd>≥ {r.minAgreementPct} %, IoU ≥ {r.minIou}, beat sphere{s9 && ", ≤ 30 % not scored"}</dd>
        </div>
        <div><dt>Bare sphere</dt><dd>{m.sphereAgreementPct.toFixed(1)} %</dd></div>
        <div><dt>Shadow: image / model</dt><dd>{m.imageShadowPct.toFixed(1)} % / {m.modelShadowPct.toFixed(1)} %</dd></div>
        {s9 ? (
          <div><dt>Not scored (grazing light)</dt><dd>{s9.excludedPct.toFixed(1)} %</dd></div>
        ) : (
          r.modelShadowDarkPct !== null && (
            <div><dt>Model shadow dark in image</dt><dd>{r.modelShadowDarkPct.toFixed(1)} % (diagnostic)</dd></div>
          )
        )}
      </dl>
      <p className="val-explanation">{m.reason}</p>
      <p className="val-explanation">
        {r.cells} cells of {r.cellM} m. Pointing shift from the PDS orthoimage: {r.shiftM[0]} m E, {r.shiftM[1]} m N
        (r = {r.shiftCorrelation}).
      </p>
      <a href={r.page} target="_blank" rel="noreferrer">LROC product page</a>. Images:{" "}
      {r.imageUrls.map((u, i) => (
        <span key={u}>
          {i > 0 && ", "}
          <a href={u} target="_blank" rel="noreferrer">{r.images[i]}</a>
        </span>
      ))}
    </article>
  );
}

export function LrocCheck() {
  const [rows, setRows] = useState<LrocResult[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadLroc().then((x) => live && setRows(x));
    return () => {
      live = false;
    };
  }, []);
  if (rows === undefined) return null;
  if (rows === null) return <p role="alert">Model shadow vs LRO images failed to load. Reload the page.</p>;
  const dev = rows.filter((r) => (r.split ?? "dev") === "dev");
  const test = rows.filter((r) => r.split === "test");
  const s8 = dev.filter((r) => r.pass).length;
  const s9 = test.filter((r) => r.s9?.pass).length;
  const order = [...test, ...dev];
  return (
    <section className="val-group" aria-label="Model shadow vs LRO images">
      <h3>
        Model shadow vs LRO images:{" "}
        {test.length > 0 && `S9 photometry ${s9} of ${test.length} new images pass, `}S8 Otsu {s8} of {dev.length} pass
      </h3>
      <details className="hud-notes val-about">
        <summary>Method</summary>
        <p className="note">
          Three LROC NAC images of the south pole with a known time. We project the calibrated images ourselves (LRO
          SPICE pointing, rays to LOLA terrain) and align them to the PDS orthoimage with one shift. Image shadow: cells
          of about 20 m darker than the Otsu threshold. Model shadow: the top of the Sun's disc is below our LOLA horizon
          (20/80/240 m) at the image time. The pass rule was fixed in eval/cases.json (S8) before the first result.
          At a grazing Sun, Otsu also puts dim sunlit slopes into the dark class, so "image only" cells are not all
          real shadow. S8 failed on all three images.
        </p>
        <p className="note">
          S9 fixes the image side with photometry. A sunlit cell has I/F = A × cos i / (cos i + cos e)
          (Lommel–Seeliger), with i and e from the LOLA slope. A cell is image shadow when it is darker than 0.3 of
          that. Cells where the Sun grazes the slope (the predicted brightness is below the shadow cut) are not scored.
          We tuned the rule on the three S8 images (dev). Then we fixed the rule and the list of new images in git and
          only after that downloaded the new images (test). The S9 result counts only the test images.
        </p>
      </details>
      <div className="val-cards">
        {order.map((r) => (
          <LrocCard key={r.id} r={r} />
        ))}
      </div>
    </section>
  );
}

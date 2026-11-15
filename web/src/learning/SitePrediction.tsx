import { useEffect, useState } from "react";
import { loadMaskOnce, loadTimeline } from "../api";
import { loadFullWindow } from "../fullWindow";
import type { Site, SiteSummary } from "../contracts";
import { fmtShare } from "../format";
import { stepUtc, summarize, terrainClearance } from "../summary";
import "./learning.css";

type Example = { site: string; date: string; elevation: number };
type Data = { rows: SiteSummary[]; example: Example | null };

/** A fresh instance also clears a prediction whenever the date or selected sites change. */
export function SitePrediction({ sites, atUtc, onReveal }: { sites: Site[]; atUtc: string; onReveal?: () => void }) {
  const pair = sites.slice(0, 2);
  return <Exercise key={`${atUtc}|${pair.map((s) => s.id).join("|")}`} sites={pair} atUtc={atUtc} onReveal={onReveal} />;
}

function Exercise({ sites, atUtc, onReveal }: { sites: Site[]; atUtc: string; onReveal?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [choice, setChoice] = useState("");
  const [checked, setChecked] = useState(false);
  const [terrainChoice, setTerrainChoice] = useState("");
  const [terrainChecked, setTerrainChecked] = useState(false);

  useEffect(() => {
    let live = true;
    async function read(): Promise<Data | null> {
      if (sites.length < 2 || sites.some((s) => s.terrain === "none")) return null;
      const results = await Promise.all(sites.map(async (site) => {
        const [mask, full, slice] = await Promise.all([loadMaskOnce(site), loadFullWindow(site), loadTimeline(site, stepUtc(atUtc))]);
        if (!mask || mask.terrain === "none" || !full || full.stub || slice.stub || !slice.sunVisible.length) return null;
        return { site, full, mask, row: summarize(slice, atUtc, full, mask) };
      }));
      if (results.some((r) => !r)) return null;
      const valid = results.filter((r) => r !== null);
      let example: Example | null = null;
      let nearest = Infinity;
      for (const { site, full, mask } of valid) {
        full.sunEl.forEach((elevation, i) => {
          if (elevation <= 0 || full.sunVisible[i] !== 0) return;
          const clearance = terrainClearance(mask, full.sunAz[i], elevation);
          if (clearance === null || clearance + 0.265 >= 0) return;
          const time = Date.parse(full.startUtc) + i * full.stepMin * 60000;
          const distance = Math.abs(time - Date.parse(atUtc));
          if (distance < nearest) {
            nearest = distance;
            example = { site: site.name, date: new Date(time).toISOString().replace(".000Z", "Z"), elevation };
          }
        });
      }
      return { rows: valid.map((r) => r.row), example };
    }
    read().then((result) => {
      if (!live) return;
      if (result) setData(result); else setUnavailable(true);
    }, () => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, []);

  const winner = data && (data.rows[0].lightFraction.value === data.rows[1].lightFraction.value
    ? "tie" : sites[data.rows[0].lightFraction.value > data.rows[1].lightFraction.value ? 0 : 1].id);
  return <section className="learning" aria-label="Predict and check">
    <h3>Predict, then check</h3>
    <p>Which site gets more sunlight in the next 30 days from {atUtc.replace("T", " ").replace("Z", " UTC")}?</p>
    {unavailable && <p role="status">Terrain data unavailable for two selected sites at this date. Choose two sites with terrain and precomputed data.</p>}
    {!data && !unavailable && <p role="status">Loading terrain data…</p>}
    <form onSubmit={(e) => { e.preventDefault(); setChecked(true); onReveal?.(); }}>
      <fieldset disabled={!data}>
        <legend>Your prediction</legend>
        {sites.map((site) => <label key={site.id}><input type="radio" name="light-prediction" value={site.id} checked={choice === site.id} onChange={(e) => setChoice(e.target.value)} /> {site.name}</label>)}
        <label><input type="radio" name="light-prediction" value="tie" checked={choice === "tie"} onChange={(e) => setChoice(e.target.value)} /> Equal</label>
      </fieldset>
      <button type="submit" disabled={!data || !choice}>Check with the model</button>
    </form>
    {checked && data && <div role="status"><p>{choice === winner ? "Your prediction matches the model." : "The model gives a different answer."}</p>
      <p>{sites[0].name}: {fmtShare(data.rows[0].lightFraction.value)}; {sites[1].name}: {fmtShare(data.rows[1].lightFraction.value)}.</p>
      <p>These are the same next-30-day Sun-lit shares as Compare. Terrain can block the low Sun.</p></div>}
    {data?.example && <form onSubmit={(e) => { e.preventDefault(); setTerrainChecked(true); }}>
      <fieldset><legend>At {data.example.site}, the Sun centre is {data.example.elevation.toFixed(1)}° above level at {data.example.date.replace("T", " ").replace("Z", " UTC")}. Is any part of the Sun visible?</legend>
        {["Yes", "No"].map((v) => <label key={v}><input type="radio" name="terrain-prediction" value={v} checked={terrainChoice === v} onChange={(e) => setTerrainChoice(e.target.value)} /> {v}</label>)}
      </fieldset>
      <button type="submit" disabled={!terrainChoice}>Check with the model</button>
      {terrainChecked && <p role="status">{terrainChoice === "No" ? "Correct. " : "Not at this time. "}The model shows the whole Sun hidden by terrain, even though its centre is above level.</p>}
    </form>}
    {data && !data.example && <p>No example of the Sun hidden above level is available for these sites.</p>}
    <details><summary>For the teacher</summary><p>Ask learners to explain why a low Sun can be hidden by a ridge. Change the date and compare the model's next-30-day shares again.</p></details>
  </section>;
}

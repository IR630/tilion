// Near / mid / full skyline layers on the horizon panorama (#334). Data: skyline/<siteId>.json
// (optional). Without the file the panorama shows the full mask only, as before.
import { useEffect, useState } from "react";
import { loadSkyline } from "../skylineApi";
import type { Site, Skyline } from "../contracts";
import "./SkylineLayers.css";

/** The skyline of a site; null while it loads or when the site has no file. */
export function useSkyline(site: Site): Skyline | null {
  const [skyline, setSkyline] = useState<Skyline | null>(null);
  useEffect(() => {
    let live = true;
    setSkyline(null);
    loadSkyline(site).then((s) => live && setSkyline(s));
    return () => {
      live = false;
    };
  }, [site]);
  return skyline;
}

const km = (m: number) => `${Math.round(m / 1000)} km`;

/** Shaded ground under the full skyline: terrain within midM, and within nearM on top of it. */
export function SkylineLayers({ skyline, x, y, H }: { skyline: Skyline; x: (az: number) => number; y: (el: number) => number; H: number }) {
  const polygon = (el: number[]) => {
    const pts = el.map((e, k) => `${x(k * skyline.azStepDeg)},${Math.min(y(e), H + 2)}`);
    pts.push(`${x(360)},${Math.min(y(el[0]), H + 2)}`); // close the seam at 360°
    return `${x(0)},${H + 2} ${pts.join(" ")} ${x(360)},${H + 2}`;
  };
  return (
    <g className="skyline-layers" aria-label={`Skyline layers: terrain within ${km(skyline.nearM)} and within ${km(skyline.midM)}`}>
      <polygon points={polygon(skyline.midDeg)} className="skyline-mid" />
      <polygon points={polygon(skyline.nearDeg)} className="skyline-near" />
    </g>
  );
}

export function SkylineLegend({ skyline }: { skyline: Skyline }) {
  return (
    <span className="skyline-legend" title="Which terrain sets the horizon: a nearby slope or a far massif">
      <span>
        <i className="skyline-key skyline-near" />
        Terrain within {km(skyline.nearM)}
      </span>
      <span>
        <i className="skyline-key skyline-mid" />
        within {km(skyline.midM)}
      </span>
      <span>
        <i className="skyline-key skyline-far" />
        farther
      </span>
    </span>
  );
}

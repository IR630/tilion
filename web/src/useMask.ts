// #206: the horizon mask of a site for the "above terrain" readouts (place card, welcome screen, globe,
// mission). Null while loading, without a mask or for a site without terrain: the readout then shows
// the angle above level only.
import { useEffect, useState } from "react";
import { loadMaskOnce } from "./api";
import type { HorizonMask, Site } from "./contracts";

export function useMask(site: Site | undefined): HorizonMask | null {
  const [mask, setMask] = useState<HorizonMask | null>(null);
  const id = site?.terrain === "none" ? undefined : site?.id;
  useEffect(() => {
    if (!site || !id) return;
    let live = true;
    loadMaskOnce(site).then((m) => live && setMask(m));
    return () => {
      live = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return mask && mask.siteId === id ? mask : null;
}

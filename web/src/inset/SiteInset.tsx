// Framed close-up of a site: hillshade tile with the scale and DEM label above it (#125). The tile is a
// static multi-directional hillshade, so it carries no date (#155).
// Standalone. The navigator mounts it and draws the outline and leader lines (insetGeometry.ts).
import { INSET_URL } from "../api";
import type { SiteInset as SiteInsetMeta } from "../contracts";
import "./siteInset.css";

/** "5 × 5 KM, LOLA 20 M": the tile size and the DEM it really comes from. */
export function insetLabel(meta: Pick<SiteInsetMeta, "sizeM" | "source">): string {
  const km = meta.sizeM / 1000;
  return `${km} × ${km} km, ${meta.source}`.toUpperCase();
}

type Props = {
  meta: SiteInsetMeta;
  siteName?: string;
  src?: string; // default: data/inset/<file>
  className?: string;
};

export function SiteInset({ meta, siteName, src, className }: Props) {
  const label = insetLabel(meta);
  return (
    <figure className={`site-inset ${className ?? ""}`} data-site={meta.siteId}>
      <figcaption className="hud-label si-label">{label}</figcaption>
      <div className="si-frame">
        <img
          className="si-img"
          src={src ?? `${INSET_URL}${meta.file}`}
          width={meta.sizePx}
          height={meta.sizePx}
          alt={`${siteName ?? meta.siteId}: hillshade, ${label}`}
          draggable={false}
        />
        {/* The tile is centred on the site: the reticle sits in the middle. */}
        <span className="si-reticle hud-brackets is-target" aria-hidden="true" />
      </div>
    </figure>
  );
}

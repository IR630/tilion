// Links that let a reader repeat Tilion's numbers in NASA tools: QuickMap, Moon Trek, JPL Horizons.
import { buildNasaLinks, type LinkSite } from "./nasaLinkUrls";
import "./nasaLinks.css";
import { Info } from "./ui/Info";

const EXT = { target: "_blank", rel: "noopener noreferrer" } as const;

export function NasaLinks({ site, atUtc }: { site: LinkSite; atUtc: string }) {
  const links = buildNasaLinks(site, atUtc);
  if (!links.quickMap) return <p className="nasa-links-note">Site coordinates are unavailable.</p>;
  return (
    <section className="nasa-links" aria-label="Check this site in NASA tools">
      <h3>
        Check in NASA tools
        <Info label="Horizons and Tilion">Horizons gives elevation above a flat horizon; Tilion adds LOLA terrain.</Info>
      </h3>
      <ul>
        <li>
          <a href={links.quickMap} {...EXT}>
            QuickMap
          </a>
        </li>
        <li>
          <a href={links.moonTrek!} {...EXT}>
            Moon Trek
          </a>
        </li>
        <li>
          {links.horizons ? (
            <a href={links.horizons} {...EXT}>
              Horizons: Sun az/el
            </a>
          ) : (
            <span className="nasa-links-off">Horizons needs a valid UTC date.</span>
          )}
        </li>
      </ul>
    </section>
  );
}

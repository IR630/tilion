// 3D terrain of a site (#10): a LOLA heightmap patch (~20×20 km), the Sun as a shadow-casting
// directional light, arrows to the Sun and the Earth. three.js is loaded on demand (own chunk).
// Scene frame: +X = local east, +Y = up, −Z = local north; 1 unit = 1 km; site at the origin.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { loadTimeline } from "../api";
import { ApproachProfile } from "../approach/ApproachProfile";
import type { Site, Timeline } from "../contracts";
import { CLEARANCE_TIP, EXAG_TIP, fmtClearance } from "../format";
import { terrainClearance } from "../summary";
import { useMask } from "../useMask";
import { cssToken } from "../globe/token";
import { Info } from "../ui/Info";
import "./hud.css";
import "./scene3d.css";

/** data/terrain/<siteId>.json — written by scripts/terrain_tiles.py; heights in <siteId>.bin. */
export type TerrainTileMeta = {
  siteId: string;
  size: number; // samples per side
  spacingM: number;
  scaleM: number; // h = int16 * scaleM + offsetM
  offsetM: number;
  minM: number;
  maxM: number;
  siteHeightM: number; // height at the centre sample
  dem: string[];
  stub?: boolean;
};
export type TerrainTile = { meta: TerrainTileMeta; heights: Float32Array };

/** First site that has a polar DEM and a known point. */
export function pickSite(sites: Site[]): Site | undefined {
  return sites.find((s) => (s.terrain === "polar80" || s.terrain === "polar240") && s.lat !== null && s.lonE !== null);
}

/** Unit vector in the scene frame for azimuth (from north to east) and elevation, degrees. */
export function dirFromAzEl(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

/** Int16 LE samples → heights in metres. Row 0 = north edge, column 0 = west edge. */
export function decodeTile(meta: TerrainTileMeta, buf: ArrayBuffer): Float32Array {
  const n = meta.size * meta.size;
  if (buf.byteLength !== n * 2) throw new Error(`terrain tile ${meta.siteId}: ${buf.byteLength} bytes, want ${n * 2}`);
  const v = new DataView(buf);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) * meta.scaleM + meta.offsetM;
  return out;
}

export async function loadTile(site: Site): Promise<TerrainTile | null> {
  const base = `${import.meta.env.BASE_URL}data/terrain/${site.id}`;
  const [m, b] = await Promise.all(["json", "bin"].map((ext) =>
    fetch(`${base}.${ext}`, { signal: AbortSignal.timeout(15000) }).catch((e: unknown) => {
      throw new Error(`${base}.${ext}: ${e}`, { cause: e });
    }),
  ));
  if (!m.ok || !b.ok) return null;
  const meta = (await m.json()) as TerrainTileMeta;
  return { meta, heights: decodeTile(meta, await b.arrayBuffer()) };
}

/** HTML overlays the scene moves every frame (view mode): a compass and labels pinned to 3D points. */
/** A site on the diorama: local km (x east, z south) and its HUD elements (dot, leader, label). */
export type HudPin = { x: number; z: number; el: HTMLElement | null };
export type Hud = {
  compass: HTMLElement | null;
  labels: Partial<Record<"ring2" | "ring5" | "sun" | "earth", HTMLElement | null>>;
  pins?: HudPin[];
};

/** Local offsets, km, of a point from the site on the mean lunar sphere: x east, z south (scene frame). */
export function localKm(site: { lat: number; lonE: number }, p: { lat: number; lonE: number }): { x: number; z: number } {
  const R = 1737.4;
  const r = Math.PI / 180;
  const dLon = ((((p.lonE - site.lonE) % 360) + 540) % 360) - 180;
  return { x: R * Math.cos(site.lat * r) * dLon * r, z: -R * (p.lat - site.lat) * r };
}

type Scene = {
  setExaggeration: (k: number) => void;
  setBodies: (sun: [number, number], earth: [number, number]) => void;
  setHud: (hud: Hud | null) => void;
  dispose: () => void;
};

/** Range rings around the site, km. */
export const RINGS_KM = [2, 5] as const;

/** Bilinear height (m) of the tile at scene x (east) and z (south), km; row 0 = north edge. */
export function heightAt(tile: TerrainTile, x: number, z: number): number {
  const { meta, heights } = tile;
  const n = meta.size;
  const W = ((n - 1) * meta.spacingM) / 1000;
  const c = Math.max(0, Math.min(n - 1, ((x + W / 2) / W) * (n - 1)));
  const r = Math.max(0, Math.min(n - 1, ((z + W / 2) / W) * (n - 1)));
  const c0 = Math.min(n - 2, Math.floor(c));
  const r0 = Math.min(n - 2, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const h = (rr: number, cc: number) => heights[rr * n + cc];
  return (
    h(r0, c0) * (1 - fc) * (1 - fr) + h(r0, c0 + 1) * fc * (1 - fr) + h(r0 + 1, c0) * (1 - fc) * fr + h(r0 + 1, c0 + 1) * fc * fr
  );
}

/** Compass heading of a view direction (dx east, dz south), degrees from north to east. */
export function headingDeg(dx: number, dz: number): number {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}

async function buildScene(canvas: HTMLCanvasElement, tile: TerrainTile): Promise<Scene> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const col = (name: string, fallback: string) => new THREE.Color(cssToken(name, fallback, canvas));
  scene.background = col("--bg", "#08090a");
  const tok = col;

  const { meta, heights } = tile;
  const W = ((meta.size - 1) * meta.spacingM) / 1000;
  const geo = new THREE.PlaneGeometry(W, W, meta.size - 1, meta.size - 1);
  geo.rotateX(-Math.PI / 2); // plane row 0 (+Y) → −Z = north
  const pos = geo.attributes.position as THREE_NS.BufferAttribute;
  for (let i = 0; i < heights.length; i++) pos.setY(i, (heights[i] - meta.siteHeightM) / 1000);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col("--g-artemis", "#c8c8c4"), roughness: 1, metalness: 0 }));
  ground.castShadow = true;
  ground.receiveShadow = true;
  scene.add(ground);

  // Diorama block (#72): the tile edges extruded down to a flat base, dark side walls.
  const base = (meta.minM - meta.siteHeightM) / 1000 - Math.max(0.4, W * 0.04);
  const n = meta.size;
  const edge = (k: number, side: number): [number, number, number] => {
    // side 0 north (row 0), 1 east (last column), 2 south (last row), 3 west (column 0); k along it
    const [r, c] = side === 0 ? [0, k] : side === 1 ? [k, n - 1] : side === 2 ? [n - 1, n - 1 - k] : [n - 1 - k, 0];
    const x = (c / (n - 1) - 0.5) * W;
    const z = (r / (n - 1) - 0.5) * W;
    return [x, (heights[r * n + c] - meta.siteHeightM) / 1000, z];
  };
  const wall: number[] = [];
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < n - 1; k++) {
      const [x0, y0, z0] = edge(k, side);
      const [x1, y1, z1] = edge(k + 1, side);
      wall.push(x0, y0, z0, x0, base, z0, x1, y1, z1, x1, y1, z1, x0, base, z0, x1, base, z1);
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
  wallGeo.computeVertexNormals();
  ground.add(new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: col("--ground", "#2b2c2e"), roughness: 1, side: THREE.DoubleSide })));

  // Range rings drape over the terrain; children of the ground, so they follow the exaggeration.
  const ringY = (x: number, z: number) => (heightAt(tile, x, z) - meta.siteHeightM) / 1000 + 0.012;
  for (const R of RINGS_KM) {
    if (R * 2 > W) continue;
    const pts: THREE_NS.Vector3[] = [];
    for (let k = 0; k <= 160; k++) {
      const a = (k / 160) * Math.PI * 2;
      const x = Math.sin(a) * R;
      const z = -Math.cos(a) * R;
      pts.push(new THREE.Vector3(x, ringY(x, z), z));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: col("--fg", "#e6e6e2"), transparent: true, opacity: 0.45, depthTest: true }),
    );
    ground.add(ring);
  }

  scene.add(new THREE.AmbientLight(col("--accent", "#ffffff"), 0.08));
  // A weak shadowless key light from the north-west reads the relief like a hillshade; the Sun
  // (shadows) is the real light of the moment.
  const fill = new THREE.DirectionalLight(col("--accent", "#ffffff"), 0.45);
  fill.position.copy(new THREE.Vector3(...dirFromAzEl(315, 45)).multiplyScalar(W));
  scene.add(fill);
  const sun = new THREE.DirectionalLight(col("--accent", "#ffffff"), 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -W * 0.75;
  sc.right = sc.top = W * 0.75;
  sc.near = 1;
  sc.far = W * 4;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const picked = tok("--red", "orangered");
  const marker = new THREE.Group();
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), new THREE.MeshBasicMaterial({ color: col("--sun", "#ff5a1f") }));
  pin.position.y = 0.3;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: col("--sun", "#ff5a1f") }));
  head.position.y = 0.6;
  marker.add(pin, head);
  scene.add(marker);

  const L = W * 0.3;
  const origin = new THREE.Vector3(0, 0.6, 0);
  const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), origin, L, col("--sun", "#ff5a1f"), L * 0.06, L * 0.03);
  const earthArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), origin, L, col("--earth", "#4a90e2"), L * 0.06, L * 0.03);
  const north = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.6, -W / 2), W * 0.08, col("--fg", "#e6e6e2"));
  scene.add(sunArrow, earthArrow, north);

  // Diorama view: narrow field of view, 35° above the horizon, from the north-east (azimuth 45°).
  const camera = new THREE.PerspectiveCamera(22, 1, 0.01, W * 40);
  camera.position.copy(new THREE.Vector3(...dirFromAzEl(45, 35)).multiplyScalar(W * 2.5));
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  let hud: Hud | null = null;
  let lastHeading = NaN;
  const v = new THREE.Vector3();
  const place = (el: HTMLElement | null | undefined, p: THREE_NS.Vector3) => {
    if (!el) return;
    v.copy(p).project(camera);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const on = v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
    el.style.opacity = on ? "1" : "0";
    if (on) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
  };
  const groundPt = new THREE.Vector3();
  const topPt = new THREE.Vector3();
  const toScreen = (q: THREE_NS.Vector3): [number, number] | null => {
    v.copy(q).project(camera);
    if (v.z >= 1) return null;
    return [((v.x + 1) / 2) * canvas.clientWidth, ((1 - v.y) / 2) * canvas.clientHeight];
  };
  const sunTip = new THREE.Vector3();
  const earthTip = new THREE.Vector3();
  const ringPt = new THREE.Vector3();
  const updateHud = () => {
    if (!hud) return;
    const dx = controls.target.x - camera.position.x;
    const dz = controls.target.z - camera.position.z;
    const heading = headingDeg(dx, dz);
    if (hud.compass && !(Math.abs(heading - lastHeading) < 0.2)) {
      lastHeading = heading;
      hud.compass.style.transform = `rotate(${-heading}deg)`;
    }
    // Ring labels on the ring point nearest to the camera.
    const len = Math.hypot(camera.position.x, camera.position.z) || 1;
    const ux = camera.position.x / len;
    const uz = camera.position.z / len;
    for (const R of RINGS_KM) {
      const x = ux * R;
      const z = uz * R;
      ringPt.set(x, ringY(x, z) * ground.scale.y + 0.05, z);
      place(hud.labels[`ring${R}` as "ring2" | "ring5"], ringPt);
    }
    place(hud.labels.sun, sunTip);
    place(hud.labels.earth, earthTip);
    for (const p of hud.pins ?? []) {
      if (!p.el) continue;
      const y = ((heightAt(tile, p.x, p.z) - meta.siteHeightM) / 1000) * ground.scale.y;
      const a = toScreen(groundPt.set(p.x, y, p.z));
      const b = toScreen(topPt.set(p.x, y + W * 0.16, p.z));
      if (!a || !b) {
        p.el.style.opacity = "0";
        continue;
      }
      p.el.style.opacity = "1";
      p.el.style.transform = `translate(${b[0]}px, ${b[1]}px)`;
      const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
      p.el.style.setProperty("--lead", `${len}px`);
      p.el.style.setProperty("--lead-angle", `${Math.atan2(a[1] - b[1], a[0] - b[0])}rad`);
    }
  };

  const resize = () => {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    updateHud();
  });

  return {
    setExaggeration(k) {
      ground.scale.y = k;
    },
    setBodies([sAz, sEl], [eAz, eEl]) {
      const s = new THREE.Vector3(...dirFromAzEl(sAz, sEl));
      sunArrow.setDirection(s);
      sun.position.copy(s.clone().multiplyScalar(W * 2));
      sun.intensity = sEl > -2 ? 3 : 0; // peaks stay lit a little below the plane horizon
      const e = new THREE.Vector3(...dirFromAzEl(eAz, eEl));
      earthArrow.setDirection(e);
      sunTip.copy(origin).addScaledVector(s, L * 1.08);
      earthTip.copy(origin).addScaledVector(e, L * 1.08);
    },
    setHud(h) {
      hud = h;
      lastHeading = NaN;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
    },
  };
}

/** One line of the HUD: angle above terrain (#206) or above level, azimuth and what the terrain does to the body. */
export function bodyLine(elDeg: number, azDeg: number, visible: boolean, clearDeg: number | null = null, sun = false): string {
  const where = visible ? "in view" : elDeg > 0 ? "behind terrain" : "below the horizon";
  return `${fmtClearance(clearDeg, elDeg, sun ? visible : undefined)}, az ${azDeg.toFixed(0)}°, ${where}`;
}

/** Sites inside the tile, numbered: the viewed site first, then by distance. */
export function tilePins(site: Site, catalog: Site[], halfKm: number): { site: Site; n: number; x: number; z: number }[] {
  if (site.lat === null || site.lonE === null) return [];
  const at = { lat: site.lat, lonE: site.lonE };
  return catalog
    .filter((s) => s.lat !== null && s.lonE !== null)
    .map((s) => ({ site: s, ...localKm(at, { lat: s.lat as number, lonE: s.lonE as number }) }))
    .filter((p) => Math.abs(p.x) < halfKm && Math.abs(p.z) < halfKm)
    .sort((a, b) => (a.site.id === site.id ? -1 : b.site.id === site.id ? 1 : Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)))
    .map((p, k) => ({ ...p, n: k + 1 }));
}

/** 3D terrain around a site as a diorama block. `view` = the "View from site" overlay (#72): the
 *  shared moment drives the time (no own slider) and a HUD shows Sun and Earth, a compass, range
 *  rings and the sites inside the tile on leader lines. */
export function Terrain3D({
  sites,
  atUtc,
  site: fixed,
  view = false,
  catalog = [],
}: {
  sites: Site[];
  atUtc: string;
  site?: Site;
  view?: boolean;
  /** All sites: those inside the tile get a numbered label. */
  catalog?: Site[];
}) {
  const site = fixed && (fixed.terrain === "polar80" || fixed.terrain === "polar240") ? fixed : fixed ? undefined : pickSite(sites);
  const mask = useMask(site);
  const compass = useRef<HTMLDivElement>(null);
  const ring2 = useRef<HTMLSpanElement>(null);
  const ring5 = useRef<HTMLSpanElement>(null);
  const sunTag = useRef<HTMLSpanElement>(null);
  const earthTag = useRef<HTMLSpanElement>(null);
  const pinBox = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene | null>(null);
  const [tile, setTile] = useState<TerrainTile | null | undefined>(undefined);
  const [tl, setTl] = useState<Timeline | null>(null);
  const [i, setI] = useState(0);
  const [ex, setEx] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!site) return;
    let live = true;
    setTile(undefined);
    setError(null);
    loadTile(site).then(
      (t) => live && setTile(t),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [site]);

  useEffect(() => {
    if (!site) return;
    let live = true;
    setI(0);
    loadTimeline(site, atUtc).then((t) => live && setTl(t));
    return () => {
      live = false;
    };
  }, [site, atUtc]);

  useEffect(() => {
    if (!tile || !canvas.current) return;
    let live = true;
    let built: Scene | null = null;
    setReady(false);
    buildScene(canvas.current, tile).then(
      (s) => {
        if (!live) return s.dispose();
        built = s;
        scene.current = s;
        setReady(true);
      },
      (e) => live && setError(`3D view is not available: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      live = false;
      built?.dispose();
      scene.current = null;
    };
  }, [tile]); // eslint-disable-line react-hooks/exhaustive-deps

  const half = tile ? (((tile.meta.size - 1) * tile.meta.spacingM) / 1000) * 0.48 : 0;
  const pins = useMemo(() => (view && site && half ? tilePins(site, catalog.length ? catalog : sites, half) : []), [view, site, catalog, sites, half]);
  useEffect(() => {
    if (!view || !scene.current) return;
    const els = Array.from(pinBox.current?.children ?? []) as HTMLElement[];
    scene.current.setHud({
      compass: compass.current,
      labels: { ring2: ring2.current, ring5: ring5.current, sun: sunTag.current, earth: earthTag.current },
      pins: pins.map((p, k) => ({ x: p.x, z: p.z, el: els[k] ?? null })),
    });
  }, [view, ready, pins]);

  useEffect(() => {
    scene.current?.setExaggeration(ex);
  }, [ex, ready]);

  useEffect(() => {
    if (!tl || tl.sunAz.length <= i || !scene.current) return;
    scene.current.setBodies([tl.sunAz[i], tl.sunEl[i]], [tl.earthAz[i], tl.earthEl[i]]);
  }, [tl, i, ready]);

  if (!site) return <p>Pick a site with a polar terrain model (LOLA 80 m or 240 m).</p>;
  const t = tl ? new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60000).toISOString().slice(0, 16) : "";
  const km = tile ? (((tile.meta.size - 1) * tile.meta.spacingM) / 1000).toFixed(1) : "";
  const dem = tile ? tile.meta.dem.map((d) => (d === "polar80" ? "LOLA 80 m" : "LOLA 240 m")).join(" + ") : "";

  return (
    <section aria-label="3D terrain" className={`terrain3d${view ? " is-view" : ""}`}>
      {!view && (
        <h2>
          {site.name} — LOLA terrain {km && `${km} × ${km} km`}
        </h2>
      )}
      {tl?.stub && (
        <p role="note" className="stub">
          Sun and Earth directions are synthetic mock data, not ephemerides. Terrain is real LOLA data.
        </p>
      )}
      {tile?.meta.stub && (
        <p role="note" className="stub">
          Terrain is a synthetic placeholder, not LOLA data.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {tile === null && <p role="alert">No terrain tile for this site (data/terrain/{site.id}).</p>}
      {tile === undefined && !error && <p className="t3d-loading">Loading terrain…</p>}
      <div className="terrain3d-view">
        <canvas ref={canvas} data-ready={ready ? "1" : "0"} aria-label={`3D terrain around ${site.name}`} role="img" />
        {view ? (
          <>
            {tl && (
              <div className="t3d-bodies" aria-label="Sun and Earth">
                <p className="t3d-body sun">
                  <span className="t3d-body-k">Sun</span>
                  <span title={CLEARANCE_TIP}>{bodyLine(tl.sunEl[i], tl.sunAz[i], tl.sunVisible[i] > 0, terrainClearance(mask, tl.sunAz[i], tl.sunEl[i]), true)}</span>
                </p>
                <p className="t3d-body earth">
                  <span className="t3d-body-k">Earth</span>
                  <span title={CLEARANCE_TIP}>{bodyLine(tl.earthEl[i], tl.earthAz[i], tl.earthVisible[i] > 0, terrainClearance(mask, tl.earthAz[i], tl.earthEl[i]))}</span>
                </p>
              </div>
            )}
            <div className="t3d-compass" aria-label="Compass" role="img">
              <div ref={compass} className="t3d-rose">
                <span className="t3d-n">N</span>
                <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
                  <path className="rose-n" d="M20 5 25 20H15Z" />
                  <path className="rose-s" d="M20 35 25 20H15Z" />
                </svg>
              </div>
            </div>
            <span ref={ring2} className="t3d-tag ring">2 km</span>
            <span ref={ring5} className="t3d-tag ring">5 km</span>
            <span ref={sunTag} className="t3d-tag sun">
              Sun
            </span>
            <span ref={earthTag} className="t3d-tag earth">
              Earth
            </span>
            <div ref={pinBox} className="t3d-pins" aria-hidden="true">
              {pins.map((p) => (
                <div key={p.site.id} className={`t3d-pin${p.site.id === site.id ? " is-here" : ""}`}>
                  <span className="t3d-pin-label">
                    <span>{p.site.name}</span>
                  </span>
                  <i className="t3d-pin-lead" />
                  <i className="t3d-pin-dot" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <ul className="terrain3d-legend">
            <li className="terrain3d-sun">Sun</li>
            <li className="terrain3d-earth">Earth</li>
            <li className="terrain3d-site">Site</li>
            <li>White arrow: north</li>
          </ul>
        )}
      </div>
      <div className="hud-bar terrain3d-controls">
        <label title={EXAG_TIP}>
          Relief height {ex}×
          <input type="range" min={1} max={5} step={0.5} value={ex} onChange={(e) => setEx(+e.target.value)} />
        </label>
        {tl && !view && (
          <label>
            Time {t.replace("T", " ")} UTC
            <input type="range" min={0} max={tl.sunAz.length - 1} value={i} onChange={(e) => setI(+e.target.value)} />
          </label>
        )}
        {/* In the site view the Sun / Earth box over the scene carries the angles: here only the DEM (#155). */}
        {tl && (
          <p role="status" className="t3d-status">
            {view ? `Terrain: ${dem}` : (
              <>
                Sun az {tl.sunAz[i].toFixed(1)}°, el {tl.sunEl[i].toFixed(1)}°; Earth az {tl.earthAz[i].toFixed(1)}°, el{" "}
                {tl.earthEl[i].toFixed(1)}°{dem && `. Terrain: ${dem}`}
              </>
            )}
          </p>
        )}
        {/* #322: what the scene shows and how to move it, behind one "?". */}
        <Info label="How to read the 3D view">
          {view && (
            <span>
              {km ? `${km} × ${km} km` : "A patch"} of real LOLA terrain around the site; shadows from the Sun at this moment;
              red ray = Sun, blue ray = Earth; dots = sites inside the tile. Rings at 2 and 5 km. Heights ×{ex}.{" "}
            </span>
          )}
          Drag to orbit, scroll to zoom, right-drag to pan.{view ? " Move the moment on the timeline below." : " Shadows are cast by the terrain."}
        </Info>
      </div>
      <ApproachProfile site={site} />
    </section>
  );
}

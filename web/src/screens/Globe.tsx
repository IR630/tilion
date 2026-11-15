// Globe (#21): the whole Moon in 3D. Relief from the LOLA global DEM (NASA SVS CGI Moon Kit),
// LROC colour, a detailed south-polar cap from the LOLA 80 m DEM. The Sun (a glowing disc and the
// light: terminator) and the Earth (a textured, spinning sphere lit by the same Sun) sit in their true
// directions at the shared moment (SPICE, MOON_ME; #157); a time change animates along the hourly
// path. An arrow at the selected site points at the Sun over its level horizon. Sites are markers,
// a click on a marker selects the site. Frame and data layouts: see ../globe/geo.ts, ../globe/bodies.ts.
import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import type { Site, Timeline } from "../contracts";
import { loadFullTimeline } from "../api";
import { CLEARANCE_TIP, EXAG_TIP, fmtAbove, fmtClearance, fmtLatLon, keepUnits } from "../format";
import { useMask } from "../useMask";
import { liveState } from "../summary";
import { dirsAt, earthAxes, easeOut, siteAzEl, tween, type Vec3 } from "../globe/bodies";
import { cssToken } from "../globe/token";
import { Select } from "../ui/Select";
import { BETA } from "../beta/flags";
import { BetaTag } from "../beta/BetaTag";
import { buildLut, FLUX_K4, LUT_NH, LUT_NLAT, type Lut, RAMP_MAX_K, RAMP_MIN_K, rampBytes } from "../beta/thermal/globeThermal";
import { ThermalLegend } from "../beta/thermal/ThermalLegend";
import "./hud.css";
import "./scene3d.css";
import {
  bodiesAt,
  decodeInt16,
  elevationDeg,
  type GlobeMeta,
  type Grid,
  latLonGrid,
  latSteps,
  lonLatToVec,
  normalMap,
  patchHeight,
  R_M,
  sampleGlobal,
  type Subpoints,
  vecToLonLat,
} from "../globe/geo";

const N_LON = 512; // shared by the globe body and the polar cap: same edge vertices
const BODY_ROWS = 240; // 90 N .. cap edge
const CAP_ROWS = 150; // cap edge .. 90 S, ~2 km per row
// Directions are true, distances and sizes are not (true Earth: ~220 R away, 3.7 R in radius).
// Sun and Earth sit on a small orrery ring round the Moon, so one view from below the south pole
// shows the sites, the Earth and the Sun together, and their turn round the Moon.
const EARTH_SHOW_R = 2.5; // Earth centre distance in the scene, Moon radii
const EARTH_R = 0.22; // Earth radius in the scene, Moon radii
const SUN_SHOW_R = 3.1; // Sun disc distance in the scene, Moon radii
const CAMERA0_LAT = -40; // start view from below the equator: the south pole faces the camera
const CAMERA0_R = 6.4; // start view distance, Moon radii
const SUN_PX = 88; // Sun glow sprite, CSS px (the white disc is ~1/5 of it)
const ARROW_PX = 72; // illumination arrow length, CSS px at any zoom
// Site markers (#154, as on the map and in FloodValue): a fixed-size dot with a dark outline at any
// zoom; the selected one red with a red ring. Sizes in CSS px, same as navigator.css .nav-marker.
const SITE_PX = 14;
const PICKED_PX = 28; // the ring; the red dot inside is 14 px
const PICK_PX = 12; // a click or hover this close to a dot centre hits it

export type GlobeData = { meta: GlobeMeta; global: Grid; patch: Grid; sub: Subpoints; color: string };

/** The whole timeline of the selected site; null without one or while loading. */
function useSiteTimeline(site: Site | undefined): Timeline | null {
  const [tl, setTl] = useState<{ id: string; tl: Timeline | null } | null>(null);
  useEffect(() => {
    if (!site) return;
    let live = true;
    loadFullTimeline(site).then(
      (t) => live && setTl({ id: site.id, tl: t }),
      () => live && setTl({ id: site.id, tl: null }),
    );
    return () => {
      live = false;
    };
  }, [site?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return site && tl?.id === site.id ? tl.tl : null;
}

export async function loadGlobe(): Promise<GlobeData> {
  const base = `${import.meta.env.BASE_URL}data/globe/`;
  const get = async (f: string) => {
    const r = await fetch(base + f, { signal: AbortSignal.timeout(60000) }).catch((e: unknown) => {
      throw new Error(`data/globe/${f}: ${e}`, { cause: e });
    });
    if (!r.ok) throw new Error(`data/globe/${f}: HTTP ${r.status}`);
    return r;
  };
  const meta = (await (await get("meta.json")).json()) as GlobeMeta;
  const [h, p, s] = await Promise.all([get(meta.height.file), get(meta.southPatch.file), get("subpoints.json")]);
  const H = meta.height;
  const P = meta.southPatch;
  return {
    meta,
    global: { w: H.width, h: H.height, v: decodeInt16(await h.arrayBuffer(), H.width * H.height, H.scaleM, H.offsetM) },
    patch: { w: P.size, h: P.size, v: decodeInt16(await p.arrayBuffer(), P.size * P.size, P.scaleM, P.offsetM) },
    sub: (await s.json()) as Subpoints,
    color: base + meta.color.file,
  };
}

/** Site height on the globe surface (m): the polar cap inside its edge, else the global map. */
function heightAt(d: GlobeData, lonE: number, lat: number): number {
  const e = d.meta.southPatch.latEdgeDeg;
  return lat < e ? patchHeight(d.global, d.patch, d.meta.southPatch.extentM, lonE, lat, e) : sampleGlobal(d.global, lonE, lat);
}

type Scene = {
  setExaggeration: (k: number) => void;
  setMoment: (ms: number) => void; // animates Sun and Earth from the shown moment to ms
  setFocus: (site: [number, number] | null) => void; // lonE, lat of the illumination arrow
  setSites: (sites: Site[], selected: string | null) => void;
  flyTo: (lonE: number, lat: number) => void;
  setThermal: (lut: Lut | null) => void; // BETA #290: null = the standard lit globe
  dispose: () => void;
};

// BETA #290: thermal colour per fragment. Latitude and hour angle from the Moon-fixed direction and
// the Sun direction (scene frame, ../globe/geo.ts), the smooth-sphere LUT, then the slope correction
// of globeThermal.terrainT with the terrain normal (body: the DEM normal map; cap: vertex normals).
const THERMAL_VERT = /* glsl */ `
varying vec3 vDir;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vDir = position;
  vN = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const THERMAL_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform sampler2D uLut;
uniform sampler2D uRamp;
uniform sampler2D uNormalMap;
uniform float uUseMap;
uniform float uK4;
uniform vec2 uRange;
varying vec3 vDir;
varying vec3 vN;
varying vec2 vUv;
const float PI = 3.141592653589793;
void main() {
  vec3 n = normalize(vDir);
  vec3 s = normalize(uSun);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float H = atan(-n.z, n.x + 1e-7) - atan(-s.z, s.x + 1e-7); // hour angle: + = afternoon
  float u = fract(H / (2.0 * PI) + 0.5) + 0.5 / ${LUT_NH.toFixed(1)};
  float v = (lat / PI + 0.5) * ${((LUT_NLAT - 1) / LUT_NLAT).toFixed(6)} + 0.5 / ${LUT_NLAT.toFixed(1)};
  vec2 lt = texture2D(uLut, vec2(u, v)).rg; // r = T on the smooth sphere, g = night floor of the row
  vec3 tn;
  if (uUseMap > 0.5) {
    vec3 east = cross(vec3(0.0, 1.0, 0.0), n);
    float el = length(east);
    east = el > 1e-4 ? east / el : vec3(1.0, 0.0, 0.0);
    vec3 north = cross(n, east);
    vec3 m = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0; // red = east, green = north (geo.normalMap)
    tn = normalize(m.x * east + m.y * north + m.z * n);
  } else {
    tn = normalize(vN);
  }
  float t2 = lt.r * lt.r;
  float t4 = t2 * t2 + uK4 * (max(0.0, dot(tn, s)) - max(0.0, dot(n, s)));
  float T = max(lt.g, sqrt(sqrt(max(0.0, t4))));
  float f = clamp((T - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  gl_FragColor = vec4(texture2D(uRamp, vec2(f * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).rgb, 1.0);
}`;

/** Labels over the canvas, placed by the scene each frame. */
type Tags = { sun: HTMLElement | null; earth: HTMLElement | null; arrow: HTMLElement | null };

async function buildScene(
  canvas: HTMLCanvasElement,
  d: GlobeData,
  k0: number,
  onPick: (id: string) => void,
  tags: Tags,
): Promise<Scene> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  // ImageBitmap: the 4096 x 2048 JPEG decodes off the main thread (an <img> decodes on upload,
  // ~1.5 s of blocked first frame in a software-GL browser). The bitmap is flipped at decode.
  const bitmap = await new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "flipY" }).loadAsync(d.color);
  const color = new THREE.Texture(bitmap);
  color.flipY = false;
  color.needsUpdate = true;
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = 4;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  // Palette from the #94 tokens.
  const tok = (name: string, fallback: string) => new THREE.Color(cssToken(name, fallback, canvas));
  const C = {
    bg: tok("--bg", "black"),
    sun: tok("--sun", "orangered"),
    earth: tok("--earth", "steelblue"),
  };
  scene.background = C.bg;
  const edge = d.meta.southPatch.latEdgeDeg;
  let k = k0;

  const mkGeo = (lats: number[], h: (lonE: number, lat: number) => number, kk: number) => {
    const g = latLonGrid(lats, N_LON, (lo, la) => 1 + (kk * h(lo, la)) / R_M);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(g.index, 1));
    return geo;
  };
  const bodyH = (lo: number, la: number) => sampleGlobal(d.global, lo, la);
  const capH = (lo: number, la: number) => patchHeight(d.global, d.patch, d.meta.southPatch.extentM, lo, la, edge);
  const bodyLats = latSteps(90, edge, BODY_ROWS);
  const capLats = latSteps(edge, -90, CAP_ROWS);

  // Shading uses the true slopes (no exaggeration), so the terminator and the shadowed slopes are
  // real; the exaggeration only lifts the relief. Body: a normal map of the global DEM on radial
  // normals (the 0.7 deg mesh only gives the silhouette). Cap: vertex normals of the ~2 km mesh of
  // the 80 m DEM at k = 1.
  const nm = new THREE.DataTexture(normalMap(d.global, 1), d.global.w, d.global.h, THREE.RGBAFormat);
  nm.wrapS = THREE.RepeatWrapping;
  nm.magFilter = nm.minFilter = THREE.LinearFilter;
  nm.needsUpdate = true;
  const bodyMat = new THREE.MeshStandardMaterial({ map: color, normalMap: nm, roughness: 1, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ map: color, roughness: 1, metalness: 0 });
  const body = new THREE.Mesh(new THREE.BufferGeometry(), bodyMat);
  const cap = new THREE.Mesh(new THREE.BufferGeometry(), capMat);
  scene.add(body, cap);

  const rebuild = () => {
    body.geometry.dispose();
    cap.geometry.dispose();
    body.geometry = mkGeo(bodyLats, bodyH, k);
    const bp = body.geometry.attributes.position as THREE_NS.BufferAttribute;
    const n = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      const v = new THREE.Vector3(bp.getX(i), bp.getY(i), bp.getZ(i)).normalize();
      n.set([v.x, v.y, v.z], i * 3);
    }
    body.geometry.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    const flat = mkGeo(capLats, capH, 1);
    flat.computeVertexNormals();
    cap.geometry = mkGeo(capLats, capH, k);
    cap.geometry.setAttribute("normal", flat.attributes.normal);
    flat.dispose();
  };

  scene.add(new THREE.AmbientLight(tok("--accent", "white"), 0.02));
  const sun = new THREE.DirectionalLight(tok("--accent", "white"), 3.2);
  scene.add(sun);
  const dot = (c: THREE_NS.Color, r: number) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
  const subSun = dot(C.sun, 0.012);
  const subEarth = dot(C.earth, 0.012);
  scene.add(subSun, subEarth);

  // Dots are sprites of a constant screen size, drawn over the relief; a dot on the far side is
  // hidden by a horizon test (below), not by the depth buffer, so a ridge never cuts it in half.
  const dotTexture = (picked: boolean) => {
    const n = 64;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    const css = (name: string, fb: string) => cssToken(name, fb, canvas);
    const disc = (r: number, fill: string) => {
      g.beginPath();
      g.arc(n / 2, n / 2, r, 0, 2 * Math.PI);
      g.fillStyle = fill;
      g.fill();
    };
    const px = n / (picked ? PICKED_PX : SITE_PX); // texture px per CSS px
    if (picked) {
      disc(n / 2, css("--red", "orangered")); // ring: 2 px red, a faint red fill inside
      g.globalCompositeOperation = "destination-out";
      disc(n / 2 - 2 * px, "black");
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 0.18;
      disc(n / 2 - 2 * px, css("--red", "orangered"));
      g.globalAlpha = 1;
    }
    disc(7 * px, css("--bg", "black")); // the 14 px dot: 2 px dark outline
    disc(5 * px, picked ? css("--red", "orangered") : css("--fg", "white"));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const dotTex = dotTexture(false);
  const pickedTex = dotTexture(true);
  const markers = new THREE.Group();
  scene.add(markers);
  let sites: Site[] = [];
  let selected: string | null = null;
  const placeMarkers = () => {
    markers.children.forEach((m) => ((m as THREE_NS.Sprite).material as THREE_NS.Material).dispose());
    markers.clear();
    for (const s of sites) {
      if (s.lat === null || s.lonE === null) continue;
      const on = s.id === selected;
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: on ? pickedTex : dotTex, sizeAttenuation: false, depthTest: false, depthWrite: false }),
      );
      m.renderOrder = on ? 2 : 1; // the selected dot on top
      const r = 1 + (k * heightAt(d, s.lonE, s.lat)) / R_M + 0.002;
      m.position.set(...lonLatToVec(s.lonE, s.lat)).multiplyScalar(r);
      m.userData = { siteId: s.id, name: s.name, px: on ? PICKED_PX : SITE_PX };
      markers.add(m);
    }
    sizeMarkers();
  };
  // sizeAttenuation off: the scale is the screen height share times 2·tan(fov/2).
  const sizeMarkers = () => {
    const h = canvas.clientHeight || 480;
    const per = (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180)) / h;
    for (const m of markers.children) m.scale.setScalar(m.userData.px * per);
  };
  // A dot on the near hemisphere only: the camera sees the surface point above its tangent plane.
  const cullMarkers = () => {
    for (const m of markers.children) m.visible = m.position.dot(camera.position) > m.position.lengthSq();
  };

  // Sun (#157): a white disc with a warm glow, constant on screen; the Moon and the Earth hide it.
  const glow = (() => {
    const n = 128;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.09, "rgba(255,253,245,1)");
    r.addColorStop(0.12, "rgba(255,236,200,0.6)");
    r.addColorStop(0.3, "rgba(255,214,160,0.18)");
    r.addColorStop(1, "rgba(255,200,140,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, n, n);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sunDisc = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, sizeAttenuation: false, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scene.add(sunDisc);

  // Earth (#157): Blue Marble on a sphere, lit by the same Sun (day and night), turned by its spin.
  // Until the texture loads (or if it fails) the sphere is plain --earth blue. Image: NASA Blue Marble
  // land_shallow_topo (public domain), https://commons.wikimedia.org/wiki/File:Land_shallow_topo_2048.jpg,
  // resized to 2048 x 1024 (column 0 = 180 W, row 0 = 90 N).
  const earthMat = new THREE.MeshStandardMaterial({ color: C.earth, roughness: 0.9, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 48, 32), earthMat);
  earth.matrixAutoUpdate = false;
  scene.add(earth);
  let earthTex: THREE_NS.Texture | null = null;
  let disposed = false;
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}data/globe/earth_color.jpg`, (t) => {
    if (disposed) return t.dispose();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    earthTex = t;
    earthMat.color.set(0xffffff);
    earthMat.map = earthMat.emissiveMap = t;
    earthMat.emissiveIntensity = 0.05; // the night side stays faintly visible: the planet is always findable
    earthMat.needsUpdate = true;
    dirty = true;
  });

  // Illumination arrow (#157) at the selected site: the level horizon as a faint disc, the arrow
  // from the site to the Sun. Unit size; scaled each frame to ARROW_PX on screen.
  const over = (m: THREE_NS.Material) => Object.assign(m, { depthTest: false, depthWrite: false, transparent: true });
  const arrowMat = over(new THREE.MeshBasicMaterial({ color: C.sun }));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 10), arrowMat);
  shaft.position.y = 0.39;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 16), arrowMat);
  head.position.y = 0.89;
  const arrow = new THREE.Group();
  arrow.add(shaft, head);
  const horizon = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 48),
    over(new THREE.MeshBasicMaterial({ color: tok("--fg", "white"), opacity: 0.16, side: THREE.DoubleSide })),
  );
  const horizonRim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 64 }, (_, i) => new THREE.Vector3(0.62 * Math.cos((i / 32) * Math.PI), 0, 0.62 * Math.sin((i / 32) * Math.PI))),
    ),
    over(new THREE.LineBasicMaterial({ color: tok("--fg", "white"), opacity: 0.5 })),
  );
  horizon.rotation.x = -Math.PI / 2; // the circle lies in the local level plane (+y = up)
  const focusG = new THREE.Group(); // +y = local up at the site
  focusG.add(horizon, horizonRim, arrow);
  [shaft, head, horizon, horizonRim].forEach((o) => (o.renderOrder = o === horizon ? 3 : 4)); // arrow over the disc
  focusG.visible = false;
  scene.add(focusG);
  let focus: [number, number] | null = null;

  let shownMs = NaN;
  let anim: { from: number; to: number; t0: number; dur: number } | null = null;
  let dirs = dirsAt(d.sub, Date.parse(d.sub.startUtc));
  const V = (v: Vec3) => new THREE.Vector3(...v);
  const placeBodies = () => {
    if (!Number.isFinite(shownMs)) return; // no moment yet
    dirs = dirsAt(d.sub, shownMs);
    const sv = V(dirs.sun);
    const ev = V(dirs.earth);
    sun.position.copy(sv).multiplyScalar(10);
    sunDisc.position.copy(sv).multiplyScalar(SUN_SHOW_R);
    const rs = (v: THREE_NS.Vector3) => {
      const [lo, la] = vecToLonLat(v.x, v.y, v.z);
      return 1 + (k * heightAt(d, lo, la)) / R_M + 0.004;
    };
    subSun.position.copy(sv).multiplyScalar(rs(sv));
    subEarth.position.copy(ev).multiplyScalar(rs(ev));
    // Earth body axes → scene: mesh x = lon 0, y = north pole, z = lon 90 W (three.js sphere UVs).
    const { pole, prime } = earthAxes(shownMs);
    const px = V(prime);
    const py = V(pole);
    earth.matrix.makeBasis(px, py, px.clone().cross(py)).setPosition(ev.multiplyScalar(EARTH_SHOW_R));
    earth.matrixWorldNeedsUpdate = true;
    if (focus) {
      const up = V(lonLatToVec(focus[0], focus[1]));
      focusG.position.copy(up).multiplyScalar(1 + (k * heightAt(d, focus[0], focus[1])) / R_M);
      focusG.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      // The arrow in the site frame: the Sun direction with the local up as +y.
      const local = sv.clone().applyQuaternion(focusG.quaternion.clone().invert());
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local.normalize());
      const { el } = siteAzEl(focus, dirs.sun);
      arrowMat.opacity = el >= 0 ? 1 : 0.45; // under the level horizon: dimmed, it points into the ground
    }
    sunDir.copy(sv); // BETA #290: the thermal shader follows the same animated Sun as the light
  };

  // BETA #290 thermal mode: built on the first switch-on, the standard materials are kept for "off".
  const sunDir = new THREE.Vector3(...dirs.sun);
  let thermal: { lut: Lut; tex: THREE_NS.DataTexture; ramp: THREE_NS.DataTexture; mats: THREE_NS.ShaderMaterial[] } | null = null;
  const disposeThermal = () => {
    if (!thermal) return;
    thermal.tex.dispose();
    thermal.ramp.dispose();
    thermal.mats.forEach((m) => m.dispose());
    thermal = null;
  };
  const setThermal = (lut: Lut | null) => {
    if (lut && thermal?.lut !== lut) {
      disposeThermal();
      const px = new Uint16Array(LUT_NLAT * LUT_NH * 4);
      for (let r = 0; r < LUT_NLAT; r++)
        for (let j = 0; j < LUT_NH; j++) {
          const o = (r * LUT_NH + j) * 4;
          px[o] = THREE.DataUtils.toHalfFloat(lut.T[r * LUT_NH + j]);
          px[o + 1] = THREE.DataUtils.toHalfFloat(lut.floor[r]);
          px[o + 3] = THREE.DataUtils.toHalfFloat(1);
        }
      const tex = new THREE.DataTexture(px, LUT_NH, LUT_NLAT, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.wrapS = THREE.RepeatWrapping; // local time wraps at midnight
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      const ramp = new THREE.DataTexture(rampBytes(256), 256, 1, THREE.RGBAFormat);
      ramp.magFilter = ramp.minFilter = THREE.LinearFilter;
      ramp.needsUpdate = true;
      const mat = (useMap: boolean) =>
        new THREE.ShaderMaterial({
          vertexShader: THERMAL_VERT,
          fragmentShader: THERMAL_FRAG,
          uniforms: {
            uSun: { value: sunDir },
            uLut: { value: tex },
            uRamp: { value: ramp },
            uNormalMap: { value: nm },
            uUseMap: { value: useMap ? 1 : 0 },
            uK4: { value: FLUX_K4 },
            uRange: { value: new THREE.Vector2(RAMP_MIN_K, RAMP_MAX_K) },
          },
        });
      thermal = { lut, tex, ramp, mats: [mat(true), mat(false)] };
    }
    (body as THREE_NS.Mesh).material = lut && thermal ? thermal.mats[0] : bodyMat;
    (cap as THREE_NS.Mesh).material = lut && thermal ? thermal.mats[1] : capMat;
    dirty = true;
  };

  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 200);
  camera.position.set(...lonLatToVec(0, CAMERA0_LAT)).multiplyScalar(CAMERA0_R);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 1.03;
  controls.maxDistance = 10;
  controls.rotateSpeed = 0.5;
  controls.update();

  // The visible dot nearest to the pointer, in screen space (the dots overlap near the pole).
  const v = new THREE.Vector3();
  const siteAt = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    let best: THREE_NS.Object3D | null = null;
    let bestD = PICK_PX;
    cullMarkers();
    for (const m of markers.children) {
      if (!m.visible) continue;
      v.copy(m.position).project(camera);
      const dd = Math.hypot(rect.left + ((v.x + 1) / 2) * rect.width - e.clientX, rect.top + ((1 - v.y) / 2) * rect.height - e.clientY);
      if (dd <= bestD) [best, bestD] = [m, dd];
    }
    return best;
  };
  // Click (not drag) on a visible dot selects its site; hover names it.
  let down: [number, number] | null = null;
  const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const id = siteAt(e)?.userData.siteId as string | undefined;
    if (id) onPick(id);
  };
  const onHover = (e: PointerEvent) => {
    if (e.buttons) return;
    const m = siteAt(e);
    canvas.style.cursor = m ? "pointer" : "";
    canvas.title = m ? (m.userData.name as string) : "";
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onHover);

  // Render on demand: a still globe costs no GPU time (and no CPU in a software-GL browser).
  let dirty = true;
  const resize = () => {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sizeMarkers();
    dirty = true;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  rebuild();
  const redraw = () => (dirty = true);
  controls.addEventListener("change", redraw);
  // Per frame (#157): the time animation, the constant screen size of the Sun and the arrow, the labels.
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pv = new THREE.Vector3();
  const pxToWorld = (px: number, dist: number) =>
    ((px * 2 * Math.tan(((camera.fov / 2) * Math.PI) / 180)) / (canvas.clientHeight || 480)) * dist;
  // Hidden behind the Moon: the segment camera → p passes through the unit sphere.
  const behindMoon = (p: THREE_NS.Vector3) => {
    const c = camera.position;
    const dv = pv.copy(p).sub(c);
    const t = Math.max(0, Math.min(1, -c.dot(dv) / dv.lengthSq()));
    return dv.multiplyScalar(t).add(c).length() < 0.995;
  };
  const tag = (el: HTMLElement | null, p: THREE_NS.Vector3, show: boolean, dyPx = 0) => {
    if (!el) return;
    const behind = !show || behindMoon(p);
    const s = pv.copy(p).project(camera);
    const off = behind || s.z > 1 || Math.abs(s.x) > 1.05 || Math.abs(s.y) > 1.05;
    el.style.visibility = off ? "hidden" : "visible";
    if (off) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    el.style.transform = `translate(${((s.x + 1) / 2) * w}px, ${((1 - s.y) / 2) * h + dyPx}px) translate(-50%, 0)`;
  };
  const frame = (now: number) => {
    if (anim) {
      const t = anim.dur > 0 ? (now - anim.t0) / anim.dur : 1;
      shownMs = anim.from + (anim.to - anim.from) * easeOut(t);
      if (t >= 1) anim = null;
      placeBodies();
      dirty = true;
    }
    if (!dirty && canvas.dataset.recording !== "1") return false;
    camera.updateMatrixWorld();
    sunDisc.scale.setScalar(pxToWorld(SUN_PX, 1));
    const fv = focus !== null && focusG.position.dot(camera.position) > focusG.position.lengthSq();
    focusG.visible = fv;
    if (fv) focusG.scale.setScalar(pxToWorld(ARROW_PX, camera.position.distanceTo(focusG.position)));
    tag(tags.sun, sunDisc.position, true);
    const ep = new THREE.Vector3().setFromMatrixPosition(earth.matrix);
    tag(tags.earth, ep, true, EARTH_R / pxToWorld(1, camera.position.distanceTo(ep)) + 6); // under the planet
    focusG.updateMatrixWorld();
    const tip = new THREE.Vector3(0, 1.05, 0).applyQuaternion(arrow.quaternion).applyMatrix4(focusG.matrixWorld);
    tag(tags.arrow, tip, fv);
    if (tags.arrow && focus) {
      const { az, el } = siteAzEl(focus, dirs.sun);
      tags.arrow.textContent = `Sun ${fmtAbove(el, "level")}, az ${az.toFixed(0)}°`; // #206 the arrow is geometry only
    }
    return true;
  };
  renderer.setAnimationLoop((now) => {
    controls.update(); // fires "change" while damping settles
    if (!frame(now)) return;
    dirty = false;
    cullMarkers();
    renderer.render(scene, camera);
  });

  return {
    setExaggeration(x) {
      if (x === k) return; // one rebuild costs ~0.3 s of CPU: skip the no-op on start
      k = x;
      rebuild();
      placeMarkers();
      placeBodies();
      dirty = true;
    },
    setMoment(ms) {
      if (!Number.isFinite(ms) || ms === (anim?.to ?? shownMs)) return;
      if (!Number.isFinite(shownMs)) {
        shownMs = ms; // the first moment: no animation
        placeBodies();
        // Start view: the Sun and the Earth as near the sides of the Moon as they can be. A body in
        // front of the Moon leaves the top of the frame, one behind it drops under the Moon.
        const [sLon] = vecToLonLat(...dirs.sun);
        const [eLon] = vecToLonLat(...dirs.earth);
        const bad = (lon: number, c: number) => {
          const x = Math.cos(((lon - c) * Math.PI) / 180);
          return x > 0 ? 1.5 * x : -x;
        };
        let c = 0;
        for (let a = 0, best = Infinity; a < 360; a += 2) {
          // #479: the Sun a little on the camera's side, so the face we see is lit (a gibbous Moon,
          // not a dark disc with a thin crescent); the Earth keeps the old rule.
          const sx = Math.cos(((sLon - a) * Math.PI) / 180);
          const v = Math.max(2 * Math.abs(sx - 0.5), bad(eLon, a));
          if (v < best) [best, c] = [v, a];
        }
        camera.position.set(...lonLatToVec(c, CAMERA0_LAT)).multiplyScalar(CAMERA0_R);
        controls.update();
      } else {
        const { from, durMs } = tween(shownMs, ms, reduced);
        anim = { from, to: ms, t0: performance.now(), dur: durMs };
      }
      dirty = true;
    },
    setFocus(site) {
      focus = site;
      focusG.visible = site !== null;
      if (Number.isFinite(shownMs)) placeBodies();
      dirty = true;
    },
    setSites(s, sel) {
      sites = s;
      selected = sel;
      placeMarkers();
      dirty = true;
    },
    flyTo(lonE, lat) {
      // Straight above the site, 0.25 R up: the site is at the canvas centre.
      camera.position.set(...lonLatToVec(lonE, lat)).multiplyScalar(1.25);
      controls.update();
      dirty = true;
    },
    setThermal,
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onHover);
      controls.removeEventListener("change", redraw);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      color.dispose();
      glow.dispose();
      earthTex?.dispose();
      dotTex.dispose();
      pickedTex.dispose();
      bitmap.close();
      nm.dispose();
      bodyMat.dispose(); // off the scene while the thermal mode is on
      capMat.dispose();
      disposeThermal();
      renderer.dispose();
    },
  };
}

const ns = (lat: number) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}`;
const lonTxt = (lonE: number) => `${lonE.toFixed(2)}° E`;

/** #197: plain names for the HUD terms, the technical term and the source in the tooltip. */
const SUB_SUN_TIP = "Sub-solar point: the place on the Moon where the Sun is straight overhead now (SPICE DE440 ephemeris).";
const SUB_EARTH_TIP = "Sub-Earth point: the place on the Moon where the Earth is straight overhead now (SPICE DE440 ephemeris).";
const SPHERE_TIP = "Angle above a flat local horizon on a smooth sphere: no timeline for this site, so no terrain.";

export function Globe({
  sites,
  atUtc,
  selected,
  onSelect,
  onOpenHorizon,
}: {
  sites: Site[];
  atUtc: string;
  selected: string | null;
  onSelect: (id: string) => void;
  /** #197: the selected site's Horizon view opens from the globe too (no place card here). */
  onOpenHorizon?: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sunTag = useRef<HTMLSpanElement>(null);
  const earthTag = useRef<HTMLSpanElement>(null);
  const arrowTag = useRef<HTMLSpanElement>(null);
  const view = useRef<Scene | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const exRef = useRef(3);
  const [data, setData] = useState<GlobeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [ex, setEx] = useState(exRef.current);
  exRef.current = ex;
  const [fly, setFly] = useState("");
  // BETA #290: thermal mode, off by default; the LUT is built on the first switch-on only.
  const [thermalOn, setThermalOn] = useState(false);
  const [folded, setFolded] = useState(false); // the info and control panels fold away to free the globe
  const [lut, setLut] = useState<Lut | null>(null);
  const [lutBusy, setLutBusy] = useState(false);

  // #393: the ~8 MB of globe data can time out on a slow link or during a deploy; Retry loads it again.
  const [attempt, setAttempt] = useState(0);
  const [dataFailed, setDataFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadGlobe().then(
      (g) => live && setData(g),
      (e) => {
        if (!live) return;
        setDataFailed(true);
        setError(`Globe data is not available: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = () => {
    setError(null);
    setDataFailed(false);
    setAttempt((a) => a + 1);
  };

  useEffect(() => {
    if (!data || !canvas.current) return;
    let live = true;
    let built: Scene | null = null;
    setReady(false);
    buildScene(canvas.current, data, exRef.current, (id) => pick.current(id), {
      sun: sunTag.current,
      earth: earthTag.current,
      arrow: arrowTag.current,
    }).then(
      (s) => {
        if (!live) return s.dispose();
        built = s;
        view.current = s;
        setReady(true);
      },
      (e) => live && setError(`3D view is not available: ${e instanceof Error ? e.message : String(e)}`),
    );
    return () => {
      live = false;
      built?.dispose();
      view.current = null;
    };
  }, [data]);

  const at = data ? bodiesAt(data.sub, atUtc) : null;
  useEffect(() => {
    if (ready) view.current?.setExaggeration(ex);
  }, [ex, ready]);
  useEffect(() => {
    if (ready) view.current?.setMoment(Date.parse(atUtc));
  }, [atUtc, ready]);
  useEffect(() => {
    view.current?.setSites(sites, selected);
  }, [sites, selected, ready]);
  useEffect(() => {
    if (ready && lut) view.current?.setThermal(thermalOn ? lut : null); // never touched until the first switch-on
  }, [thermalOn, lut, ready]);
  const toggleThermal = () => {
    if (lutBusy) return;
    if (thermalOn || lut || !at) return setThermalOn(!thermalOn);
    setThermalOn(true);
    setLutBusy(true);
    const subLat = at.sun[1];
    setTimeout(() => {
      // ~1 s of CPU once (37 latitudes x one lunation of the 1D model); the label says "Computing" meanwhile.
      setLut(buildLut(subLat));
      setLutBusy(false);
    }, 30);
  };

  const sel = sites.find((s) => s.id === selected && s.lat !== null && s.lonE !== null);
  useEffect(() => {
    if (ready) view.current?.setFocus(sel ? [sel.lonE as number, sel.lat as number] : null);
  }, [sel?.lonE, sel?.lat, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const selTl = useSiteTimeline(sel);
  // #162: the selected site reads the same hourly SPICE values as the place card and Compare;
  // the smooth-sphere geometry is only the fallback for a site without a timeline.
  const selMask = useMask(sel);
  const selNow = selTl ? liveState(selTl, atUtc, selMask) : null;
  const located = sites.filter((s) => s.lat !== null && s.lonE !== null);

  return (
    <section aria-label="Globe" className="globe hud-screen">
      <div className="hud-title">
        <h2>The Moon — LOLA relief, LROC colour, Sun and Earth at the selected moment</h2>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          {dataFailed && (
            <button type="button" onClick={retry}>
              Retry
            </button>
          )}
        </p>
      )}
      {!data && !error && <p>Loading globe…</p>}
      {at?.clamped && (
        <p role="note" className="stub">
          The moment is outside the SPICE range 2026-12-01 … 2028-01-01: Sun and Earth are shown for {at.utc} UTC.
        </p>
      )}
      <div className="hud-frame scene3d-frame">
        <div className="terrain3d-view">
          <canvas ref={canvas} data-ready={ready ? "1" : "0"} role="img" aria-label="3D globe of the Moon" />
          <div className="globe-tags" aria-hidden="true">
            <span ref={sunTag} className="globe-tag globe-tag-sun">
              Sun
            </span>
            <span ref={earthTag} className="globe-tag globe-tag-earth">
              Earth
              <small><span className="globe-tag-long">directions true, distances </span>not to scale</small>
            </span>
            <span ref={arrowTag} className="globe-tag globe-tag-arrow" />
          </div>
          <ul className="terrain3d-legend">
            <li className="terrain3d-sun">Sun direction and sub-solar point</li>
            <li className="terrain3d-earth">Earth (not to scale) and sub-Earth point</li>
            <li className="terrain3d-site">Selected site</li>
            <li className="terrain3d-dot">Sites (click to select)</li>
          </ul>
        </div>
        {at && (
          <p role="status" className="scene3d-status">
            <span title={SUB_SUN_TIP}>Sun overhead at</span> {ns(at.sun[1])}, {lonTxt(at.sun[0])};{" "}
            <span title={SUB_EARTH_TIP}>Earth overhead at</span> {ns(at.earth[1])}, {lonTxt(at.earth[0])}
          </p>
        )}
        {sel && at && !folded && (
          <p aria-label="Selected site" className="scene3d-selected">
            Selected: <b>{keepUnits(sel.name)}</b> {fmtLatLon(sel.lat, sel.lonE)}.{" "}
            {selNow ? (
              <span title={CLEARANCE_TIP}>
                Sun {fmtClearance(selNow.sunClearDeg, selNow.sunElDeg, selNow.sunUp)}; Earth{" "}
                {fmtClearance(selNow.earthClearDeg, selNow.earthElDeg)} (hourly data)
              </span>
            ) : (
              <span title={SPHERE_TIP}>
                Sun {fmtAbove(elevationDeg([sel.lonE as number, sel.lat as number], at.sun), "level")}; Earth{" "}
                {fmtAbove(elevationDeg([sel.lonE as number, sel.lat as number], at.earth, at.earthDistKm), "level")} (smooth sphere, no terrain)
              </span>
            )}{" "}
            {onOpenHorizon && (
              <button type="button" className="globe-horizon-btn" onClick={() => onOpenHorizon(sel.id)}>
                Horizon view
              </button>
            )}
          </p>
        )}
      </div>
      <div className={`hud-bar terrain3d-controls${folded ? " globe-folded" : ""}`}>
        <button type="button" className="globe-fold" aria-expanded={!folded} title={folded ? "Show the site and control panels" : "Hide the site and control panels"} onClick={() => setFolded(!folded)}>
          {folded ? "Show panels ▴" : "Hide panels ▾"}
        </button>
        {!folded && (<>
        <label title={EXAG_TIP}>
          Relief height {ex}×
          <input type="range" min={1} max={10} step={1} value={ex} onChange={(e) => setEx(+e.target.value)} />
        </label>
        <label>
          Fly to site{" "}
          <Select
            label="Fly to site"
            value={fly}
            options={[{ value: "", label: "—" }, ...located.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(id) => {
              setFly(id);
              const s = located.find((x) => x.id === id);
              if (s) view.current?.flyTo(s.lonE as number, s.lat as number);
            }}
          />
        </label>
        {BETA.thermal && (
          <span className="globe-thermal">
            <BetaTag />
            <button type="button" aria-pressed={thermalOn} disabled={!ready || lutBusy} onClick={toggleThermal}>
              {lutBusy ? "Thermal: computing…" : thermalOn ? "Thermal on" : "Thermal"}
            </button>
          </span>
        )}
        {BETA.thermal && thermalOn && lut && <ThermalLegend siteName={sel?.name} tl={selTl} atUtc={atUtc} />}
        </>)}
      </div>
      {/* Sources fold into one small popover (#155): the globe keeps only what a planner reads. */}
      <details className="terrain3d-hint globe-sources">
        <summary>Sources</summary>
        Drag to rotate, scroll to zoom. Relief: LOLA via NASA SVS CGI Moon Kit (global), LOLA 80 m DEM south of{" "}
        {data ? Math.abs(data.meta.southPatch.latEdgeDeg) : 80}° S. Ephemeris: SPICE DE440, frame MOON_ME. Earth image: Blue Marble (public domain).
      </details>
    </section>
  );
}

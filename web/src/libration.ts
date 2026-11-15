// Libration of the Earth in the lunar sky: the apparent wobble of the Earth track in a timeline window.

export type Libration = { azDeg: number; elDeg: number; halfDeg: number };

const finite = (v: number) => Number.isFinite(v);

/** Circular span of azimuths, degrees: 360 minus the largest empty gap, so a track over 0/360 is not 360° wide. */
function azSpan(az: number[]): number {
  const a = az
    .filter(finite)
    .map((v) => ((v % 360) + 360) % 360)
    .sort((p, q) => p - q);
  if (a.length < 2) return 0;
  let gap = a[0] + 360 - a[a.length - 1];
  for (let k = 1; k < a.length; k++) gap = Math.max(gap, a[k] - a[k - 1]);
  return 360 - gap;
}

/**
 * Half-range of the Earth wobble in the timeline window, degrees. The azimuth span is scaled by cos(elevation)
 * to get an angle on the sky. Returns null for an empty or too short window or for non-finite data.
 */
export function earthLibration(earthAz: number[], earthEl: number[]): Libration | null {
  const n = Math.min(earthAz.length, earthEl.length);
  if (n < 2) return null;
  const az = earthAz.slice(0, n);
  const el = earthEl.slice(0, n).filter(finite);
  if (el.length < 2 || !az.some(finite)) return null;
  const elSpan = Math.max(...el) - Math.min(...el);
  const meanEl = el.reduce((s, v) => s + v, 0) / el.length;
  const azDeg = azSpan(az) * Math.cos((meanEl * Math.PI) / 180);
  return { azDeg, elDeg: elSpan, halfDeg: Math.max(azDeg, elSpan) / 2 };
}

/** Caption under the panorama, or null when the data give no wobble. */
export function librationCaption(l: Libration | null): string | null {
  if (!l || !(l.halfDeg > 0)) return null;
  return `Earth wobbles ±${l.halfDeg.toFixed(1)}° in the sky (libration). That is why it crosses the ridge.`;
}

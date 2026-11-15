import { useState } from "react";

// Free-space link equation. Station gain and noise: DSN 810-005 module 104Q (34 m antennas);
// atmosphere loss: module 105E. https://deepspace.jpl.nasa.gov/dsndocs/810-005/
// All path and equipment losses are positive dB; antenna gains are dBi.
export type Profile = { powerW: number; frequencyGHz: number; distanceKm: number; txGain: number; rxGain: number; losses: number; noiseK: number; rate: number; required: number };
export function calculateBudget(p: Profile): { fspl: number; ebn0: number; margin: number } | null {
  if (Object.values(p).some((v) => !Number.isFinite(v)) || p.powerW <= 0 || p.frequencyGHz <= 0 || p.distanceKm <= 0 || p.noiseK <= 0 || p.rate <= 0 || p.losses < 0) return null;
  const c = 299792458;
  const k = 1.380649e-23;
  const fspl = 20 * Math.log10(4 * Math.PI * p.distanceKm * 1000 * p.frequencyGHz * 1e9 / c);
  const ebn0 = 10 * Math.log10(p.powerW) + p.txGain + p.rxGain - p.losses - fspl - 10 * Math.log10(k * p.noiseK * p.rate);
  const margin = ebn0 - p.required;
  return [fspl, ebn0, margin].every(Number.isFinite) ? { fspl, ebn0, margin } : null;
}

const fields: [keyof Profile, string][] = [
  ["powerW", "Transmitter power (W)"], ["frequencyGHz", "Frequency (GHz)"], ["distanceKm", "Path distance (km)"],
  ["txGain", "Transmit antenna gain (dBi)"], ["rxGain", "Receive antenna gain (dBi)"], ["losses", "Other losses, total (dB)"],
  ["noiseK", "Receiver system noise temperature (K)"], ["rate", "Bit rate (bit/s)"], ["required", "Required Eb/N0, including coding (dB)"],
];
export function LinkBudget() {
  const [values, setValues] = useState<Partial<Record<keyof Profile, string>>>({});
  const parsed = Object.fromEntries(fields.map(([key]) => [key, values[key]?.trim() ? Number(values[key]) : NaN])) as Profile;
  const result = calculateBudget(parsed);
  return <details className="hud-notes">
    <summary>Educational radio link budget</summary>
    <p>Enter a mission profile and a station's antenna parameters. All values are user assumptions; no station schedule or link geometry is checked.</p>
    <div>{fields.map(([key, label]) => <label key={key} style={{ display: "block" }}>
      {label} <input type="number" step="any" value={values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
    </label>)}</div>
    {result ? <p>Free-space loss {result.fspl.toFixed(1)} dB, Eb/N0 {result.ebn0.toFixed(1)} dB, margin {result.margin.toFixed(1)} dB</p> : <p>Not calculated: enter valid values in every field. Power, frequency, distance, temperature and rate must be positive; losses cannot be negative.</p>}
    <p>FSPL = 20 log10(4πdf/c); Eb/N0 = Ptx + Gtx + Grx − FSPL − other losses − 10 log10(kTR); margin = Eb/N0 − required Eb/N0. Power in this equation is in dBW; distance in metres, frequency in Hz.</p>
    <p>Provide losses and a required Eb/N0 for the chosen coding and receiver. Weather, pointing, multipath, relays and station availability are not modelled. A positive margin does not confirm a contact.</p>
    <p>Station gain and noise temperature: <a href="https://deepspace.jpl.nasa.gov/dsndocs/810-005/104/104Q.pdf">DSN 810-005, module 104Q</a> (34 m antennas). Atmosphere loss: <a href="https://deepspace.jpl.nasa.gov/dsndocs/810-005/105/105E.pdf">module 105E</a>.</p>
  </details>;
}

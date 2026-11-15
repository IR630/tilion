"""1D regolith heat conduction: Hayne et al. 2017, JGR Planets 122, Appendix A.

https://doi.org/10.1002/2017JE005387 (preprint https://arxiv.org/abs/1711.00977).
Parameters: Table A1. Explicit scheme: Eqs. A13-A20. Surface: Eqs. A21-A29 (Newton).
Bottom: Eq. A30. Grid: Eqs. A32-A33. Start profile: Eqs. A34-A36.
Our code; checked against the reference values of Table A2 (S10 in eval/cases.json).
"""

import math

import numpy as np

SIGMA = 5.670374419e-8  # W m-2 K-4
S0 = 1361.0  # solar constant at 1 AU, W m-2
P_SYN = 2.55024e6  # synodic day, s
EMIS = 0.95
A0, A_A, A_B = 0.12, 0.06, 0.25  # albedo at normal incidence and Eq. A8 constants
LAW = (A0, A_A, A_B)  # Eq. A8, fitted at low latitudes
POLAR = (
    A0,
    0.0,
    0.0,
)  # constant 0.12 of the polar terrain model, Hayne et al. 2021 (Nat. Astron.) Methods
KS, KD = 7.4e-4, 3.4e-3  # contact conductivity at the surface and at depth, W m-1 K-1
RHOS, RHOD = 1100.0, 1800.0  # density at the surface and at depth, kg m-3
H = 0.06  # density e-folding scale, m (Table A1 average)
CHI = 2.7  # radiative conductivity parameter
CP = (8.9093e-9, -1.2340e-5, 2.3616e-3, 2.7431, -3.6125)  # c4..c0, J kg-1 K-n
QB = 0.018  # interior heat flow, W m-2


def albedo(inc, law=LAW):
    """Bond albedo at solar incidence angle inc (rad), Eq. A8; law = (A0, a, b)."""
    a0, a, b = law
    return a0 + a * (inc / (math.pi / 4)) ** 3 + b * (inc / (math.pi / 2)) ** 8


def absorbed(flux, inc, law=LAW):
    """(1 - A(inc)) * flux, W m-2: flux is the solar flux on the surface."""
    return (1.0 - albedo(inc, law)) * flux


class Column:
    """Layer grid and depth profiles; skin depth from surface properties (cp 600, as heat1d)."""

    def __init__(self, m=10, n=5, b=20):
        zs = math.sqrt(KS / (RHOS * 600.0) * P_SYN / math.pi)
        dz = [zs / m]
        while sum(dz) < b * zs:
            dz.append(dz[-1] * (1 + 1 / n))
        self.z = np.concatenate([[0.0], np.cumsum(dz)])
        self.dz = np.diff(self.z)
        e = np.exp(-self.z / H)
        self.rho = RHOD - (RHOD - RHOS) * e  # Eq. A2
        self.kc = KD - (KD - KS) * e  # Eq. A5 with Eq. A2
        d3 = self.dz[1:] * self.dz[:-1] * (self.dz[1:] + self.dz[:-1])
        self.p = 2 * self.dz[1:] / d3  # Eq. A18
        self.q = 2 * self.dz[:-1] / d3

    def start(self, t_noon):
        """Initial profile, Eqs. A34-A36."""
        tn = t_noon / math.sqrt(2)
        return tn - (tn - t_noon) * np.exp(-self.z / H)


def run(col: Column, qs: np.ndarray, step_s: float, t=None, fourier=0.5):
    """Temperature profile after each forcing step (steps x layers; column 0 is the surface).

    qs: absorbed solar flux per step, W m-2, held constant inside the step.
    Inside a step the explicit scheme takes sub-steps under the stability bound (Eq. A20).
    Returns (profile per step, final profile).
    """
    if t is None:
        t = col.start((max(float(np.max(qs)), 1.0) / (EMIS * SIGMA)) ** 0.25)
    t = t.copy()
    k0, b0 = col.kc[0], col.kc[0] * CHI / 350.0**3
    dz0 = col.dz[0]
    out = np.empty((len(qs), len(t)))
    for j, q in enumerate(qs):
        left = step_s
        while left > 0:
            k = col.kc * (1 + CHI * (t / 350.0) ** 3)  # Eq. A4
            rc = col.rho * np.polyval(CP, t)
            a = col.p * k[:-2]  # alpha_i: conductivity between layers i-1 and i
            b = col.q * k[1:-1]  # beta_i: between layers i and i+1
            dt = min(left, fourier * float(np.min(rc[1:-1] / (a + b))))
            t[1:-1] += dt / rc[1:-1] * (a * t[:-2] - (a + b) * t[1:-1] + b * t[2:])  # Eq. A17
            # Surface energy balance, Eqs. A21-A29.
            ts, t1, t2 = t[0], t[1], t[2]
            for _ in range(50):
                grad = (-3 * ts + 4 * t1 - t2) / (2 * dz0)
                f = EMIS * SIGMA * ts**4 - q - (k0 + b0 * ts**3) * grad
                fp = (
                    4 * EMIS * SIGMA * ts**3
                    - 3 * b0 * ts**2 * grad
                    + 3 * (k0 + b0 * ts**3) / (2 * dz0)
                )
                d = -f / fp
                ts += d
                if abs(d) < 1e-3:
                    break
            t[0] = ts
            t[-1] = t[-2] + QB / k[-2] * col.dz[-1]  # Eq. A30
            left -= dt
        out[j] = t
    return out, t


def equator_day(lat_deg=0.0, r_au=1.0, step_s=600.0, cycles=40, law=LAW):
    """Surface temperature over one synodic day on flat ground, Sun on the equator (Eq. A9, delta = 0).

    Returns (local time in hours from noon 0..24, temperature K) of the last of `cycles` days.
    """
    h = 2 * math.pi * np.arange(0, P_SYN, step_s) / P_SYN  # hour angle from noon
    mu = np.clip(math.cos(math.radians(lat_deg)) * np.cos(h), 0.0, None)
    inc = np.arccos(mu)
    qs = np.array([absorbed(S0 / r_au**2 * m, i, law) for m, i in zip(mu, inc)])
    col = Column()
    t = None
    for _ in range(cycles):
        ts, t = run(col, qs, step_s, t)
    return h / (2 * math.pi) * 24, ts[:, 0]


def at_depth(col: Column, prof: np.ndarray, depth_m: float) -> np.ndarray:
    """Temperature at depth_m per step, linear between the grid nodes."""
    i = int(np.searchsorted(col.z, depth_m)) - 1
    w = (depth_m - col.z[i]) / col.dz[i]
    return prof[:, i] * (1 - w) + prof[:, i + 1] * w

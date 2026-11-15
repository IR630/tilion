# TILION wordmark (#163, #247): constructed caps on a 100-unit cap height.
# One light for the whole word, from the right, as on the O (a lunar disc: the counter is offset,
# so the rim is thin on the night side and thick on the lit side). Every letter gains weight
# toward the lit side: the T bar and the L foot are wedges, the N has a thin left stem and a heavy
# diagonal. The I's stay plain and keep the rhythm.
# Usage: python3 scripts/wordmark.py <out dir>  → wordmark.svg and the two path strings for Wordmark.tsx.
import sys

H, S, G = 100, 17, 20


def poly(*pts):
    return "M" + "L".join(f"{x:g} {y:g}" for x, y in pts) + "z"


def rect(x, y, w, h):
    return poly((x, y), (x + w, y), (x + w, y + h), (x, y + h))


def disc(cx, cy, r):
    return f"M{cx - r:g} {cy:g}a{r:g} {r:g} 0 1 0 {2 * r:g} 0a{r:g} {r:g} 0 1 0 {-2 * r:g} 0z"


def T(x, a=8, b=23):
    w = 92
    return w, [poly((x, 0), (x + w, 0), (x + w, b), (x, a)), rect(x + (w - S) / 2, 10, S, H - 10)], []


def I(x):
    return S, [rect(x, 0, S, H)], []


def L(x, a=10, b=23):
    w = 70
    return w, [rect(x, 0, S, H - a + 0.5), poly((x, H - a), (x + w, H - b), (x + w, H), (x, H))], []


def O(x):
    r = H / 2
    return 2 * r, [], [disc(x + r, r, r) + disc(x + r - 9, r, r - S + 3)]  # counter shifted to the night side


def N(x, thin=7, diag=24):
    w = 92
    return w, [rect(x, 0, thin, H), rect(x + w - S, 0, S, H), poly((x, 0), (x + diag, 0), (x + w, H), (x + w - diag, H))], []


x, letters, disc_paths = 0, [], []
for fn in [T, I, L, I, O, N]:
    w, a, b = fn(x)
    letters += a
    disc_paths += b
    x += w + G
W = x - G
d, o = "".join(letters), "".join(disc_paths)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:g} {H}" fill="currentColor">'
       f'<path d="{d}"/><path fill-rule="evenodd" d="{o}"/></svg>')
open(f"{sys.argv[1]}/wordmark.svg", "w").write(svg)
print(f"viewBox 0 0 {W:g} {H}\nletters {d}\ndisc {o}")

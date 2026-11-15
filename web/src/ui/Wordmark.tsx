// The TILION wordmark (#163, #247): our own constructed capitals, not a font; cap height 100 units.
// One light from the right for the whole word. The O is a lunar disc: its counter is offset, so the
// rim is thick on the lit side and thin on the night side. The other letters gain weight toward the
// same lit side: wedge T bar and L foot, thin left N stem. Generator: scripts/wordmark.py.
// Drawn in currentColor; height follows the font size.

export function Wordmark({ className, title = "Tilion" }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 488 100" role="img" aria-label={title} fill="currentColor" style={{ height: "0.72em", width: "auto", display: "inline-block", verticalAlign: "baseline", overflow: "visible" }}>
      <path d="M0 0L92 0L92 23L0 8zM37.5 10L54.5 10L54.5 100L37.5 100zM112 0L129 0L129 100L112 100zM149 0L166 0L166 90.5L149 90.5zM149 90L219 77L219 100L149 100zM239 0L256 0L256 100L239 100zM396 0L403 0L403 100L396 100zM471 0L488 0L488 100L471 100zM396 0L420 0L488 100L464 100z" />
      <path fillRule="evenodd" d="M276 50a50 50 0 1 0 100 0a50 50 0 1 0 -100 0zM281 50a36 36 0 1 0 72 0a36 36 0 1 0 -72 0z" />
    </svg>
  );
}

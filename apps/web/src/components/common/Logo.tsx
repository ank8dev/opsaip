// The Opsaip marks, copied from brand/logo/ (wordmark-baton and symbol).
// Ink follows the text colour; the dot follows --op-logo-dot (lime on dark, ink on light).

/** "opsa/p": the wordmark with the baton in place of the i. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-5 70.62 380 82.38" role="img" aria-label="Opsaip">
      <g fill="none" strokeWidth="10" strokeLinecap="butt" strokeLinejoin="round">
        <ellipse cx="26" cy="100" rx="26" ry="20" stroke="currentColor" />
        <path d="M62 77.5 Q62 75 64.5 75 L69.5 75 Q72 75 72 77.5 L72 150.5 Q72 153 69.5 153 L64.5 153 Q62 153 62 150.5 Z" fill="currentColor" stroke="none" />
        <ellipse cx="93" cy="100" rx="26" ry="20" stroke="currentColor" />
        <path d="M175.1 85.31 C169.37 80.81 162.28 80 156 80 C144 80 136 85 136 91 C136 98 144 100 156 100 C168 100 177 103 177 110 C177 116 169 120 156 120 C148.08 120 140.93 118.45 135.93 114.67" stroke="currentColor" />
        <path d="M171.48 88.78 L171.81 89.08 Q173.68 90.74 175.34 88.87 L178.66 85.13 Q180.32 83.26 178.45 81.6 L178.12 81.3 Z" fill="currentColor" stroke="none" />
        <path d="M139.51 111.16 L139.17 110.86 Q137.28 109.22 135.64 111.11 L132.36 114.89 Q130.72 116.78 132.61 118.41 L132.95 118.71 Z" fill="currentColor" stroke="none" />
        <ellipse cx="218" cy="100" rx="26" ry="20" stroke="currentColor" />
        <path d="M239 77.5 Q239 75 241.5 75 L246.5 75 Q249 75 249 77.5 L249 122.5 Q249 125 246.5 125 L241.5 125 Q239 125 239 122.5 Z" fill="currentColor" stroke="none" />
        <path d="M261.12 122.91 Q259.75 125 262.25 125 L269.2 125 Q271.7 125 273.07 122.91 L292.61 93.09 Q293.98 91 291.48 91 L284.52 91 Q282.02 91 280.65 93.09 Z" fill="currentColor" stroke="none" />
        <circle cx="296.77" cy="77.62" r="7" className="op-logo-dot" stroke="none" />
        <path d="M313 77.5 Q313 75 315.5 75 L320.5 75 Q323 75 323 77.5 L323 150.5 Q323 153 320.5 153 L315.5 153 Q313 153 313 150.5 Z" fill="currentColor" stroke="none" />
        <ellipse cx="344" cy="100" rx="26" ry="20" stroke="currentColor" />
      </g>
    </svg>
  );
}

/** The long baton alone: the symbol. */
export function Symbol({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-28.09 39.43 95.57 95.57" role="img" aria-label="Opsaip">
      <path className="op-baton-mark" d="M-7.88 122.91 Q-9.25 125 -6.75 125 L0.2 125 Q2.7 125 4.07 122.91 L37.49 71.9 Q38.86 69.81 36.36 69.81 L29.4 69.81 Q26.9 69.81 25.53 71.9 Z" />
      <circle className="op-tip" cx="41.65" cy="56.43" r="7" />
    </svg>
  );
}

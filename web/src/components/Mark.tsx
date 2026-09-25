/** The clinic's mark: a strip of tape across a rounded square. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="var(--accent)" />
      <path d="M-2 19 19 -2 27 6 6 27Z" fill="var(--accent-ink)" opacity="0.22" />
      <path d="M4 22 22 4" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

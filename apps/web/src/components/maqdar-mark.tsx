/** Reference cube mark. Decorative next to the accessible MAQDAR wordmark. */
export function MaqdarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" className={className} aria-hidden="true" fill="none">
      <path d="m18 1 15 8-15 8L3 9z" fill="#0a7851" />
      <path d="m18 1 7 4-7 4-7-4z" fill="#0a4c3c" />
      <path d="m2 12 14 8v17L2 29z" fill="#07573e" />
      <path d="m20 20 14-8v17l-14 8z" fill="#159467" />
      <path d="m18 10 8 5v10l-8 5-8-5V15z" fill="#fff" />
      <path d="m18 13 5 3-5 3-5-3z" fill="#c7e7db" />
      <path d="m18 20 5-3v6l-5 3z" fill="#0d7450" />
      <path d="m13 17 4 3v6l-4-3z" fill="#0c543f" />
    </svg>
  )
}

/** ZeeSpare's precision Z. Decorative beside the accessible wordmark. */
export function ZeeSpareMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false" fill="none">
      <path d="M8 10h36v12L26 42h30v12H8V42l18-20H8z" fill="currentColor" />
      <path d="M48 10h8v12h-8z" fill="#c2f970" />
    </svg>
  )
}

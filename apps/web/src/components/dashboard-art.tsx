import { useId } from 'react'

/** Decorative reference artwork; no operational data or interactive content. */
export function DashboardArt({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 650 180" className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#33af8a" stopOpacity=".03" />
          <stop offset="1" stopColor="#42b896" stopOpacity=".22" />
        </linearGradient>
        <pattern
          id={`${id}-dots`}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(18)"
        >
          <circle cx="1" cy="1" r=".8" fill="#389c8d" />
        </pattern>
        <radialGradient id={`${id}-fade`}>
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <ellipse cx="320" cy="96" rx="260" ry="95" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <path d="M30 0C8 60 26 138 112 180H250C135 150 81 76 30 0Z" fill={`url(#${id}-wash)`} />
      <path
        d="M18 55C82 164 186 113 297 180H475C410 66 308 111 243 164 111 190 65 115 18 55Z"
        fill={`url(#${id}-wash)`}
      />
      <g fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`}>
        <path d="m119 24 24-9 18 10 24-4 39 21 19-4 18 16-18 10-24-3-10 18-20 9-10 23-15-7-4-22-16-11-29-3-18-24zM187 105l32 6 21 22-6 20-17 17-8 33-16-17-4-37-12-20zM270 28l22-9 14 11-10 22-15-3zM320 52l20-12 23 5 16-14 34 2 27-13 43 15 35 3 35 23-6 24-34-3-18 20-15-7-15 16-23-8-8-19-21-4-13 14-21-4-15-16-20 6zM340 90l28-9 30 13 16 26-13 22-17 27-17-6-8-23-22-14-7-23zM453 112l20-2 12 17 20 7-8 9-25-15zM508 142l33-10 26 14-3 19-31 5-26-12z" />
      </g>
      <g stroke="#4aaa96" strokeWidth=".65" opacity=".65">
        <path d="M124 124C237 183 298 33 441 65S541 200 637 143" />
        <path d="M143 153C260 174 329 63 442 82S546 184 629 176" />
        <path d="M204 166C318 155 355 101 446 105S548 180 624 177" opacity=".5" />
      </g>
      <circle cx="355" cy="113" r="6" fill="#2cac7a" opacity=".85" />
    </svg>
  )
}

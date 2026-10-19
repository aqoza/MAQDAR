/** A conceptual parts network, deliberately without operational data or metrics. */
export function PlanningIllustration() {
  return (
    <svg viewBox="24 64 572 304" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="planning-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#b6d8bf" opacity="0.18" />
        </pattern>
        <linearGradient
          id="planning-top"
          x1="220"
          y1="90"
          x2="390"
          y2="210"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f0f4d7" />
          <stop offset="1" stopColor="#b9dbac" />
        </linearGradient>
        <linearGradient
          id="planning-front"
          x1="250"
          y1="170"
          x2="310"
          y2="300"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#97c9a2" />
          <stop offset="1" stopColor="#4b8b6d" />
        </linearGradient>
        <radialGradient id="planning-glow">
          <stop stopColor="#9fd8aa" stopOpacity="0.24" />
          <stop offset="1" stopColor="#9fd8aa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path fill="url(#planning-dots)" d="M0 0h620v400H0z" />
      <ellipse cx="310" cy="216" rx="280" ry="170" fill="url(#planning-glow)" />
      <g stroke="#9fc5ab" strokeOpacity="0.24">
        <ellipse cx="310" cy="224" rx="246" ry="130" />
        <ellipse cx="310" cy="224" rx="195" ry="102" strokeDasharray="3 7" />
        <path d="m64 224 246-130 246 130-246 130L64 224Z" />
        <path d="M310 60v314M30 224h560" strokeDasharray="3 7" />
      </g>
      <g stroke="#a2cda8" strokeWidth="1.5" strokeLinejoin="round">
        <path d="m120 164 83 44 107-57 190 101M120 280l83-44 107 57 190-101" strokeOpacity="0.65" />
        <path d="m120 164 83 44 107-57 190 101" strokeDasharray="3 10" stroke="#e1e9b7" />
        <path d="M310 130v44m0 109v49" strokeOpacity="0.65" />
      </g>
      <g stroke="#a9c9ae" strokeOpacity="0.55" strokeLinejoin="round">
        <path d="m78 156 42-23 42 23v46l-42 23-42-23v-46Z" fill="#174b3d" />
        <path d="m78 156 42 23 42-23m-42 23v46m-20-80 42 23v18" />
        <path d="m458 242 42-23 42 23v46l-42 23-42-23v-46Z" fill="#174b3d" />
        <path d="m458 242 42 23 42-23m-42 23v46m-20-80 42 23v18" />
        <path d="m93 272 27-15 27 15v30l-27 15-27-15v-30Z" fill="#205b47" />
        <path d="m93 272 27 15 27-15m-27 15v30" />
        <path d="m473 164 27-15 27 15v30l-27 15-27-15v-30Z" fill="#205b47" />
        <path d="m473 164 27 15 27-15m-27 15v30" />
      </g>
      <g transform="translate(-49.6 -34.56) scale(1.16)">
        <ellipse cx="310" cy="294" rx="100" ry="25" fill="#051f18" fillOpacity="0.36" />
        <path
          d="m224 166 86-47 86 47v99l-86 47-86-47v-99Z"
          fill="#153e32"
          stroke="#b9d8af"
          strokeOpacity="0.35"
        />
        <path d="m224 166 86 47 86-47-86-47-86 47Z" fill="url(#planning-top)" />
        <path d="m224 166 86 47v99l-86-47v-99Z" fill="url(#planning-front)" />
        <path d="m310 213 86-47v99l-86 47v-99Z" fill="#3c795c" />
        <path d="m268 142 86 47v35l-19 10v-35l-86-47 19-10Z" fill="#f7f3d9" fillOpacity="0.65" />
        <path d="m242 234 25 14m-25-5 17 10" stroke="#e8efd4" strokeOpacity="0.7" strokeWidth="2" />
        <path
          d="m339 267 12 6 21-33"
          stroke="#dcebc5"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g fill="#dbe6b6">
        <circle cx="203" cy="208" r="3" />
        <circle cx="415" cy="207" r="3" />
        <circle cx="310" cy="332" r="3" />
      </g>
      <g stroke="#c5d8bd" strokeOpacity="0.65">
        <path d="M302 78h16m-8-8v16M65 286h10m-5-5v10M548 112h10m-5-5v10" />
      </g>
    </svg>
  )
}

/** Decorative workspace artwork, never a chart of the organization's demand. */
export function ForecastHeroIllustration() {
  return (
    <svg viewBox="0 0 600 250" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id="forecast-area"
          x1="325"
          y1="65"
          x2="325"
          y2="225"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#64B9FF" stopOpacity=".8" />
          <stop offset="1" stopColor="#8872FF" stopOpacity=".08" />
        </linearGradient>
        <linearGradient
          id="forecast-glass"
          x1="50"
          y1="20"
          x2="420"
          y2="250"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity=".94" />
          <stop offset="1" stopColor="white" stopOpacity=".3" />
        </linearGradient>
        <filter id="forecast-shadow" x="-35%" y="-40%" width="180%" height="200%">
          <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#7775D8" floodOpacity=".15" />
        </filter>
      </defs>
      <path
        d="M12 146C105 219 111 24 224 77S359 211 449 91 559 82 590 40"
        stroke="#B7B9F5"
        strokeWidth="2"
        strokeDasharray="3 8"
      />
      <ellipse
        cx="354"
        cy="149"
        rx="220"
        ry="89"
        fill="#C7D8FF"
        fillOpacity=".22"
        transform="rotate(-9 354 149)"
      />
      <g filter="url(#forecast-shadow)">
        <rect
          x="166"
          y="42"
          width="287"
          height="165"
          rx="20"
          fill="url(#forecast-glass)"
          stroke="white"
          strokeWidth="2"
          transform="rotate(-5 166 42)"
        />
        <path
          d="M188 165C211 159 215 130 236 139S260 157 281 111 311 80 330 103 354 151 378 126 416 148 436 123L436 183 188 205Z"
          fill="url(#forecast-area)"
        />
        <path
          d="M188 165C211 159 215 130 236 139S260 157 281 111 311 80 330 103 354 151 378 126 416 148 436 123"
          stroke="#6A85FF"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M311 61V190" stroke="white" strokeWidth="2" />
        <circle cx="311" cy="87" r="8" fill="#E8F5FF" stroke="white" strokeWidth="4" />
        <circle cx="311" cy="87" r="3" fill="#458CFF" />
        <g transform="rotate(9 429 47)">
          <rect
            x="410"
            y="33"
            width="156"
            height="145"
            rx="18"
            fill="url(#forecast-glass)"
            stroke="white"
            strokeWidth="2"
          />
          <rect x="426" y="51" width="32" height="32" rx="11" fill="#E9EDFF" />
          <path
            d="M435 73V65M442 73V59M449 73V62"
            stroke="#6672F7"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M471 58H541M471 69H522" stroke="#A9ADE0" strokeWidth="6" strokeLinecap="round" />
          <path
            d="M429 108H543M429 123H529M429 138H505"
            stroke="#C8CCF3"
            strokeWidth="8"
            strokeLinecap="round"
          />
        </g>
        <g transform="rotate(-8 110 146)">
          <rect
            x="58"
            y="119"
            width="151"
            height="90"
            rx="17"
            fill="url(#forecast-glass)"
            stroke="white"
            strokeWidth="2"
          />
          <path
            d="M80 151L90 141 101 148 114 132"
            stroke="#8264EF"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M80 173H175M80 185H151" stroke="#C8C8EC" strokeWidth="6" strokeLinecap="round" />
        </g>
      </g>
      <circle cx="149" cy="65" r="4" fill="#C1B4FF" />
      <circle cx="485" cy="217" r="4" fill="#91D4FA" />
      <circle cx="567" cy="107" r="3" fill="white" />
    </svg>
  )
}

export function DemandCheckIllustration() {
  return (
    <svg viewBox="0 0 240 145" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient
          id="check-glass"
          x1="65"
          y1="25"
          x2="175"
          y2="125"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FCFCFF" />
          <stop offset="1" stopColor="#CEDAFF" />
        </linearGradient>
      </defs>
      <ellipse
        cx="122"
        cy="77"
        rx="93"
        ry="54"
        stroke="#D0D4FD"
        strokeDasharray="3 6"
        transform="rotate(-16 122 77)"
      />
      <rect
        x="55"
        y="61"
        width="106"
        height="68"
        rx="15"
        fill="#D8E1FF"
        fillOpacity=".5"
        transform="rotate(-21 55 61)"
      />
      <rect
        x="62"
        y="43"
        width="111"
        height="76"
        rx="16"
        fill="url(#check-glass)"
        stroke="white"
        strokeWidth="2"
        transform="rotate(-14 62 43)"
      />
      <path
        d="M82 88L98 67 114 75 136 49"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="164"
        cy="84"
        r="21"
        fill="#E4EFFF"
        fillOpacity=".8"
        stroke="#526BFF"
        strokeWidth="5"
      />
      <path d="M180 100L198 118" stroke="#526BFF" strokeWidth="7" strokeLinecap="round" />
      <circle cx="49" cy="100" r="4" fill="#45C793" />
      <circle cx="186" cy="26" r="4" fill="#B4BBFF" />
      <circle cx="209" cy="76" r="3" fill="#D9DCFF" />
    </svg>
  )
}

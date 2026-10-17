import { useId } from 'react'

export type PageHeaderPattern =
  'items' | 'locations' | 'suppliers' | 'imports' | 'forecasts' | 'replenishment' | 'settings'

function Gear({ x, y, radius = 42 }: { x: number; y: number; radius?: number }) {
  const outline = Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2
    const toothRadius = index % 4 < 2 ? radius : radius * 0.86
    return `${Math.cos(angle) * toothRadius},${Math.sin(angle) * toothRadius}`
  }).join(' ')
  return (
    <g transform={`translate(${x} ${y}) rotate(-18)`}>
      <polygon points={outline} fill="#e5f3ee" />
      <circle r={radius * 0.67} />
      <circle r={radius * 0.36} />
      <circle r={radius * 0.28} />
      {Array.from({ length: 8 }, (_, index) => (
        <circle
          key={index}
          cx={Math.cos((index / 8) * Math.PI * 2) * radius * 0.52}
          cy={Math.sin((index / 8) * Math.PI * 2) * radius * 0.52}
          r="3"
        />
      ))}
    </g>
  )
}

function Bearing({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(23)`}>
      <ellipse cx="8" cy="-4" rx="35" ry="48" fill="#e9f6f1" />
      <ellipse rx="35" ry="48" />
      <ellipse rx="30" ry="43" />
      <ellipse rx="20" ry="32" />
      <ellipse rx="15" ry="27" />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2
        return (
          <ellipse key={index} cx={Math.cos(angle) * 25} cy={Math.sin(angle) * 37} rx="3" ry="4" />
        )
      })}
      <path d="M0-48 8-52M0 48l8-4M35 0l8-4" />
    </g>
  )
}

function Carton({ x, y, size = 36 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 36})`}>
      <path d="m0-18 32 16v32L0 48l-32-18V-2Z" fill="#e3f2ec" />
      <path d="M-32-2 0 14 32-2M0 14v34M-16-10 16 6v13" />
    </g>
  )
}

function Warehouse({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="m-39-7 37-24 42 21v42L0 52l-39-20Z" fill="#e4f3ed" />
      <path d="m-39-7 39 19 40-22M0 12v40M10 47V23l21-11v24M-28 3v21l16 8V11" />
    </g>
  )
}

function ItemsDrawing() {
  return (
    <>
      <Bearing x={300} y={61} />
      <g transform="translate(406 94) skewY(-12) scale(.86 1)">
        <Gear x={10} y={-6} radius={49} />
        <Gear x={0} y={0} radius={49} />
      </g>
      <g transform="translate(493 120) rotate(25)">
        <ellipse rx="30" ry="44" />
        <ellipse cx="7" cy="-3" rx="30" ry="44" />
        <ellipse rx="26" ry="39" />
      </g>
      <g transform="translate(629 56) rotate(23)">
        <path d="M-35-34v69M35-34v69" />
        <ellipse cy="-34" rx="35" ry="14" fill="#e5f3ee" />
        <ellipse cy="35" rx="35" ry="14" />
        <ellipse cy="35" rx="29" ry="10" />
        {Array.from({ length: 12 }, (_, index) => (
          <path key={index} d={`M${-30 + index * 5} -28v61`} strokeDasharray="2 3" />
        ))}
      </g>
      <g transform="translate(227 128) rotate(28)">
        <path d="m-8-7 8-5 8 5v9L0 7l-8-5ZM0 7v21m-4-20v22m8-24v22M-5 14l10-5M-5 22l10-5" />
      </g>
      <g transform="translate(715 42) rotate(-20)">
        <path d="m-8-7 8-5 8 5v9L0 7l-8-5ZM0 7v25m-4-23v23m8-25v23M-5 15l10-5M-5 23l10-5" />
      </g>
      <path d="m171 94 84-39 79 39 67-35m99 76 61-30 56 28 74-37" strokeDasharray="3 6" />
    </>
  )
}

function LocationsDrawing() {
  return (
    <>
      <path
        d="m151 107 154-81 164 81-154 81ZM213 75l163 82M267 47l164 82M207 137l156-81M261 164l155-81"
        opacity=".45"
      />
      <Warehouse x={588} y={47} />
      {[
        [296, 57],
        [443, 112],
        [695, 119],
      ].map(([x, y]) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <ellipse cy="38" rx="25" ry="8" opacity=".6" />
          <path d="M0 33C-7 23-20 8-20-5a20 20 0 1 1 40 0C20 8 7 23 0 33Z" fill="#e7f5ef" />
          <circle cy="-5" r="7" />
        </g>
      ))}
      <path d="M296 90Q393-2 588 48M443 145q130-54 252 7" strokeDasharray="3 5" />
    </>
  )
}

function SuppliersDrawing() {
  return (
    <>
      <path
        d="m242 58 129-29 161 66 131-53M242 58l53 91 237-54 128 48M371 29l-76 120M663 42l-3 101"
        strokeDasharray="3 5"
      />
      <g transform="translate(495 65)">
        <path d="M-55 49V7l29 13V0L7 17V-28h13v50l36 17v35Z" fill="#e4f3ed" />
        <path d="m-55 49 73 34 38-9M18 83V42l38-3M-43 28l11 5v12l-11-5Zm26 12 11 5v12l-11-5ZM8 52l10 5" />
        <path d="M7-28h13M7-20h13" />
      </g>
      <Carton x={242} y={50} size={22} />
      <Warehouse x={663} y={35} />
      <Carton x={304} y={133} size={27} />
    </>
  )
}

function ImportsDrawing() {
  return (
    <>
      <g transform="translate(237 36)">
        <path d="M15 15h65v102H15ZM0 0h47l25 24v78H0Z" fill="#e8f5ef" />
        <path d="M47 0v24h25M13 41h43M13 53h43M13 65h27M13 81h21" />
      </g>
      <g transform="translate(469 38)">
        <rect width="150" height="107" rx="6" fill="#e4f3ed" />
        <path d="M0 25h150M0 52h150M0 79h150M42 0v107M97 0v107" />
        <path
          d="M12 13h17M54 13h28M109 13h25M12 39h17M54 39h28M109 39h25M12 66h17M54 66h28"
          opacity=".6"
        />
      </g>
      <path
        d="M319 56h112m-9-6 9 6-9 6M319 86h112m-9-6 9 6-9 6M319 118h112m-9-6 9 6-9 6"
        strokeDasharray="3 5"
      />
      <path d="M690 76V20m-15 15 15-15 15 15M673 87v22h34V87" strokeWidth="2" />
    </>
  )
}

function ForecastsDrawing() {
  return (
    <>
      <path
        d="M418 89 482 58l65 31 65-58 65 28 61-48v136l-61-36-65 38-65-22-65 15-64-26Z"
        fill="#cdeade"
        fillOpacity=".45"
        stroke="none"
      />
      <path d="m163 126 64-38 64 19 64-58 63 40" strokeWidth="1.7" />
      <path d="m418 89 64 7 65-26 65 24 65-16 61-16" strokeDasharray="4 5" strokeWidth="1.7" />
      {[
        [163, 126],
        [227, 88],
        [291, 107],
        [355, 49],
        [418, 89],
        [482, 96],
        [547, 70],
        [612, 94],
        [677, 78],
        [738, 62],
      ].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="4" fill="#b8ddce" />
      ))}
    </>
  )
}

function ReplenishmentDrawing() {
  return (
    <>
      <Carton x={238} y={104} size={27} />
      <Carton x={401} y={65} size={43} />
      <Carton x={544} y={131} size={20} />
      <path
        d="M272 107q32-44 84-30m-9-5 9 5-9 6M449 91l49 28m-5-10 5 10-12-1M437 45q66-48 149-4"
        strokeDasharray="3 5"
      />
      <g transform="translate(609 25)">
        <rect width="90" height="104" rx="5" fill="#e9f6f0" />
        {[23, 48, 73].map((y) => (
          <g key={y}>
            <circle cx="18" cy={y} r="7" />
            <path d={`m14 ${y} 3 3 6-7M34 ${y - 2}h39M34 ${y + 5}h26`} />
          </g>
        ))}
      </g>
    </>
  )
}

function SettingsDrawing() {
  return (
    <>
      <Gear x={442} y={86} radius={49} />
      <Gear x={520} y={127} radius={31} />
      <path d="M181 57h144M181 88h144M181 119h144M581 43l91 15-41 83-76-33Z" />
      {[
        [215, 57],
        [291, 88],
        [246, 119],
      ].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="8" fill="#e6f4ee" />
      ))}
      {[
        [581, 43],
        [672, 58],
        [631, 141],
      ].map(([x, y]) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <circle r="18" fill="#e9f6f0" />
          <circle cy="-5" r="5" />
          <path d="M-9 10a9 9 0 0 1 18 0Z" />
        </g>
      ))}
    </>
  )
}

const drawings = {
  items: ItemsDrawing,
  locations: LocationsDrawing,
  suppliers: SuppliersDrawing,
  imports: ImportsDrawing,
  forecasts: ForecastsDrawing,
  replenishment: ReplenishmentDrawing,
  settings: SettingsDrawing,
}

/** Static decoration only. The forecast motif is illustration, never a business-data chart. */
export function PageHeaderArt({ pattern }: { pattern: PageHeaderPattern }) {
  const id = useId()
  const Drawing = drawings[pattern]
  return (
    <div className="page-banner-backdrop" aria-hidden="true">
      <svg
        className="page-banner-art"
        viewBox="0 0 780 180"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <defs>
          <pattern id={`${id}-dots`} width="13" height="13" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".65" fill="#87bdab" />
          </pattern>
          <linearGradient id={`${id}-fade`}>
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".3" stopColor="white" stopOpacity=".8" />
            <stop offset=".82" stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}-mask`}>
            <rect width="780" height="180" fill={`url(#${id}-fade)`} />
          </mask>
        </defs>
        <g mask={`url(#${id}-mask)`}>
          <rect width="780" height="180" fill={`url(#${id}-dots)`} opacity=".55" />
          <g
            stroke="#5caa94"
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity=".58"
          >
            <path d="m72 120 87-45 70 34M655 145l58-32 44 23" opacity=".55" />
            <Drawing />
          </g>
          <g fill="#398f70" opacity=".65">
            <circle cx="159" cy="75" r="2" />
            <circle cx="713" cy="113" r="2" />
          </g>
        </g>
      </svg>
    </div>
  )
}

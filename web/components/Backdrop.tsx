// Cinematic automotive backdrop (spec §19.6): a stylized front-car silhouette with glowing
// headlights, fixed low on the screen behind all content. Pure SVG/CSS — no image asset, no
// network. pointer-events-none so it never intercepts clicks; it sits behind the app (z-0).
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg
        className="absolute bottom-0 left-1/2 h-[62%] w-[1600px] max-w-none -translate-x-1/2 opacity-[0.55]"
        viewBox="0 0 1600 620"
        fill="none"
        preserveAspectRatio="xMidYMax meet"
      >
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1a20" />
            <stop offset="1" stopColor="#05090c" />
          </linearGradient>
          <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#bdeffb" stopOpacity="0.95" />
            <stop offset="0.5" stopColor="#4fd6e0" stopOpacity="0.5" />
            <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Wide low body: cabin dome over a broad shoulder line and bumper. */}
        <path
          d="M120 620 C 150 470 260 405 430 385 C 560 300 1040 300 1170 385 C 1340 405 1450 470 1480 620 Z"
          fill="url(#body)"
        />
        {/* Shoulder highlight to hint sheet-metal reflection. */}
        <path
          d="M430 388 C 560 312 1040 312 1170 388"
          stroke="#1b3640"
          strokeWidth="2"
          strokeOpacity="0.7"
          fill="none"
        />

        {/* Headlights — angled slits with a soft teal glow. */}
        <g>
          <ellipse cx="470" cy="470" rx="150" ry="60" fill="url(#lamp)" />
          <path d="M395 452 C 445 440 520 444 560 462 C 520 476 445 480 400 474 Z" fill="#d7f6fb" fillOpacity="0.85" />
        </g>
        <g>
          <ellipse cx="1130" cy="470" rx="150" ry="60" fill="url(#lamp)" />
          <path d="M1205 452 C 1155 440 1080 444 1040 462 C 1080 476 1155 480 1200 474 Z" fill="#d7f6fb" fillOpacity="0.85" />
        </g>

        {/* Lower grille shadow. */}
        <path d="M560 560 C 760 540 840 540 1040 560 L 1010 600 L 590 600 Z" fill="#04070a" fillOpacity="0.9" />
      </svg>
    </div>
  );
}

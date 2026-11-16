const paths = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.2-4.2',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  chat: 'M21 12a8 8 0 0 1-8 8H6l-3 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z',
  trash: 'M4 7h16M9 7V5h6v2m-8 0 1 12h8l1-12M10 11v5m4-5v5',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4',
  play: 'm8 5 11 7-11 7V5Z',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9V5h10v10h-4M5 9h10v10H5V9Z',
  terminal: 'M4 5h16v14H4V5Zm4 4 3 3-3 3m6 0h4',
  x: 'm6 6 12 12M18 6 6 18',
  check: 'm5 13 4 4L19 7',
  plus: 'M12 5v14M5 12h14',
  attach: 'M20.5 11.5 12.6 19.4a5.2 5.2 0 0 1-7.4-7.4l8.4-8.4a3.5 3.5 0 0 1 4.9 4.9l-8.4 8.4a1.9 1.9 0 1 1-2.6-2.6l7.7-7.7',
  alert: 'M12 4 2.5 20h19L12 4Zm0 5v6m0 3v.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  arrowUp: 'M12 19V5m-7 7 7-7 7 7',
  dot: 'M12 12h.01',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  coins: 'M12 3c4.4 0 8 1.6 8 3.5S16.4 10 12 10 4 8.4 4 6.5 7.6 3 12 3Zm-8 3.5v5C4 13.4 7.6 15 12 15s8-1.6 8-3.5v-5M4 11.5v5C4 18.4 7.6 20 12 20s8-1.6 8-3.5v-5',
}

export function Icon({ name, size = 18, className = '' }) {
  if (name === 'stop') {
    return (
      <svg
        className={`icon ${className}`}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
      </svg>
    )
  }
  const d = paths[name]
  if (!d) return null
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

export function Logo({ size = 30 }) {
  return (
    <span className="logo" style={{ width: size, height: size }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 7 5 5-5 5M13 17h6" />
      </svg>
    </span>
  )
}

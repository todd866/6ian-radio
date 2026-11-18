// One stroke icon set, 24-unit grid, 1.8 stroke. Symbols carry meaning; labels live in aria-label.
const P: Record<string, React.ReactNode> = {
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  next: <><path d="M6 6l9 6-9 6z" fill="currentColor" stroke="none" /><path d="M18 6v12" /></>,
  prev: <><path d="M18 6l-9 6 9 6z" fill="currentColor" stroke="none" /><path d="M6 6v12" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  'heart-on': <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor" />,
  more: <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></>,
  less: <><circle cx="12" cy="12" r="8" /><path d="M8 12h8" /></>,
  disc: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.5" /></>,
  set: <><path d="M3 17c3-8 5-8 7-3s4 5 6-2 3-6 5-4" /></>,
  map: <><circle cx="7" cy="8" r="1.6" fill="currentColor" /><circle cx="16" cy="6" r="1.6" fill="currentColor" /><circle cx="12" cy="13" r="1.6" fill="currentColor" /><circle cx="6" cy="17" r="1.6" fill="currentColor" /><circle cx="18" cy="16" r="1.6" fill="currentColor" /></>,
  me: <><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  down: <path d="M6 9l6 6 6-6" />,
  thumbup: <path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" />,
  'thumbup-on': <path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" fill="currentColor" />,
  thumbdown: <path d="M17 13V4h3v9zM17 13l-4 7c-1.5 0-2.5-1-2.2-2.6l.6-3.4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17" />,
  turn: <path d="M6 18V11a4 4 0 0 1 4-4h8m-3-3 3 3-3 3" />,
};
export function Icon({ n, size = 22 }: { n: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[n]}
    </svg>
  );
}

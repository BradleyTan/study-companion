// Small line icons for the timetable (currentColor, decorative: the words are always there too).
const base = { "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const ChalkboardIcon = ({ size = 14 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 16 16"><rect x="1.5" y="2" width="13" height="9" rx="1" /><path d="M5 14l1.5-3M11 14l-1.5-3M4 6h5" /></svg>
);
export const PencilIcon = ({ size = 14 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z" /></svg>
);
export const RepeatIcon = ({ size = 12 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 16 16"><path d="M13 7a5 5 0 1 0-1.5 4.5M13 3v4H9" /></svg>
);
export const CalendarIcon = ({ size = 20 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="13.5" rx="2" /><path d="M2.5 8.5h15M6.5 2v4M13.5 2v4" /></svg>
);
export const LinkIcon = ({ size = 18 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 20 20"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" /></svg>
);
export const LockIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size} viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
);
export const PlusIcon = ({ size = 16 }: { size?: number }) => (
  <svg {...base} strokeWidth={2.6} width={size} height={size} viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg>
);

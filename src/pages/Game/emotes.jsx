// Reactions from the people (and creatures) of the island: eight small
// round portraits, each with its own line and its own sound.

export const EMOTES = [
  { key: 'sheep', name: 'Sheep', line: 'Baa-rilliant!', bg: '#c9ec9c' },
  { key: 'dragon', name: 'Dragon', line: 'Rawr…', bg: '#d9cdf6' },
  { key: 'merchant', name: 'Merchant', line: 'Fancy a trade?', bg: '#f6dca8' },
  { key: 'knight', name: 'Knight', line: 'For the realm!', bg: '#c9d6ea' },
  { key: 'farmer', name: 'Farmer', line: 'What a harvest!', bg: '#fbe59b' },
  { key: 'miner', name: 'Miner', line: 'Rock solid.', bg: '#d3d8de' },
  { key: 'lumberjack', name: 'Lumberjack', line: 'Timber!', bg: '#bfe2c3' },
  { key: 'builder', name: 'Builder', line: 'Well played.', bg: '#f4c9b2' },
];

export const EMOTE_KEYS = EMOTES.map((emote) => emote.key);
export const emoteOf = (key) => EMOTES.find((emote) => emote.key === key) || null;

const SKIN = '#f2c7a0';
const SKIN_DARK = '#c98d62';
const INK = '#2b2622';

// A plain friendly face for the people, at (0, 3) in a 64 unit circle.
const Face = ({ mouth = 'smile', brows = null }) => (
  <>
    <circle cx="32" cy="36" r="15" fill={SKIN} stroke={SKIN_DARK} strokeWidth="1.2" />
    <circle cx="26.5" cy="35" r="1.8" fill={INK} />
    <circle cx="37.5" cy="35" r="1.8" fill={INK} />
    <circle cx="23" cy="40" r="2.4" fill="#f09b8a" opacity="0.55" />
    <circle cx="41" cy="40" r="2.4" fill="#f09b8a" opacity="0.55" />
    {mouth === 'smile' && <path d="M27 42q5 4 10 0" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />}
    {mouth === 'open' && <ellipse cx="32" cy="43" rx="3.2" ry="2.6" fill="#8a3a2a" />}
    {mouth === 'smirk' && <path d="M28 43q4 2 8-1" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />}
    {brows && <path d={brows} fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />}
  </>
);

const PORTRAITS = {
  sheep: (
    <>
      {[[18, 30], [24, 20], [34, 17], [44, 21], [48, 31], [44, 42], [20, 42]].map(([cx, cy]) => (
        <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="9" fill="#ffffff" stroke="#d8d4c8" strokeWidth="1" />
      ))}
      <ellipse cx="32" cy="38" rx="11" ry="13" fill="#3f3a35" />
      <ellipse cx="19" cy="34" rx="5" ry="2.6" fill="#3f3a35" transform="rotate(-20 19 34)" />
      <ellipse cx="45" cy="34" rx="5" ry="2.6" fill="#3f3a35" transform="rotate(20 45 34)" />
      <circle cx="28" cy="35" r="2.6" fill="#ffffff" />
      <circle cx="36" cy="35" r="2.6" fill="#ffffff" />
      <circle cx="28.4" cy="35.4" r="1.3" fill={INK} />
      <circle cx="36.4" cy="35.4" r="1.3" fill={INK} />
      <ellipse cx="32" cy="45" rx="4" ry="2.6" fill="#5c544c" />
      <circle cx="32" cy="24" r="6" fill="#ffffff" stroke="#d8d4c8" strokeWidth="1" />
    </>
  ),
  dragon: (
    <>
      <path d="M20 22 16 10 26 19zM44 22 48 10 38 19z" fill="#f3e6c4" stroke="#8d7a4c" strokeWidth="1" />
      <ellipse cx="32" cy="33" rx="16" ry="14" fill="#7b62c4" stroke="#3d2c78" strokeWidth="1.4" />
      <ellipse cx="32" cy="43" rx="11" ry="7" fill="#9c86df" stroke="#3d2c78" strokeWidth="1.2" />
      <circle cx="28" cy="42" r="1.2" fill="#2a1f50" />
      <circle cx="36" cy="42" r="1.2" fill="#2a1f50" />
      <path d="M22 31q4 3 8 0M34 31q4 3 8 0" fill="none" stroke="#2a1f50" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M27 47l2 3 2-3M33 47l2 3 2-3" fill="#ffffff" stroke="#3d2c78" strokeWidth="0.6" />
      <path d="M44 18c4-2 7 0 7 3M47 13c3-1 5 1 5 3" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </>
  ),
  merchant: (
    <>
      <Face mouth="smirk" />
      <path d="M15 28c2-12 32-12 34 0-6-3-28-3-34 0z" fill="#b8323a" stroke="#7a1d24" strokeWidth="1.2" />
      <circle cx="32" cy="20" r="3" fill="#f2c230" stroke="#9a6f00" strokeWidth="0.8" />
      <path d="M24 48q8 6 16 0" fill="none" stroke="#5c3b1e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="46" r="6" fill="#f2c230" stroke="#9a6f00" strokeWidth="1.2" />
      <text x="48" y="49" textAnchor="middle" fontSize="8" fontWeight="800" fill="#7a5300">¢</text>
    </>
  ),
  knight: (
    <>
      <path d="M32 6c6 4 10 4 14 2-2 5-7 7-12 6z" fill="#d1503f" />
      <path d="M17 34a15 15 0 0 1 30 0v12a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3z" fill="#c7cdd6" stroke="#4d5560" strokeWidth="1.4" />
      <path d="M21 33h22v5H21z" fill="#2f353d" />
      <path d="M32 19v30" stroke="#9aa3ae" strokeWidth="1.2" />
      <circle cx="27" cy="35.5" r="1.4" fill="#ffe27a" />
      <circle cx="37" cy="35.5" r="1.4" fill="#ffe27a" />
      <path d="M24 43h16M24 46h16" stroke="#8b939e" strokeWidth="1" />
    </>
  ),
  farmer: (
    <>
      <Face mouth="open" brows="M24 30q3-2 5 0M35 30q3-2 5 0" />
      <ellipse cx="32" cy="24" rx="20" ry="4.5" fill="#e8c35a" stroke="#a57d1a" strokeWidth="1.2" />
      <path d="M22 23c1-8 19-8 20 0z" fill="#f0cf6b" stroke="#a57d1a" strokeWidth="1.2" />
      <path d="M22 21h20" stroke="#c0392b" strokeWidth="2.4" />
      <path d="M50 52V34" stroke="#b07f08" strokeWidth="1.6" />
      {[30, 34, 38].map((y) => (
        <g key={y}>
          <ellipse cx="47.6" cy={y} rx="1.6" ry="2.8" fill="#e0a811" transform={`rotate(-30 47.6 ${y})`} />
          <ellipse cx="52.4" cy={y} rx="1.6" ry="2.8" fill="#e0a811" transform={`rotate(30 52.4 ${y})`} />
        </g>
      ))}
    </>
  ),
  miner: (
    <>
      <Face mouth="smile" />
      <path d="M17 31c0-12 30-12 30 0z" fill="#f2c230" stroke="#9a6f00" strokeWidth="1.2" />
      <path d="M15 31h34" stroke="#9a6f00" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="24" r="4" fill="#fff6c9" stroke="#9a6f00" strokeWidth="1" />
      <path d="M32 20 28 10M32 20l4-10" stroke="#fff6c9" strokeWidth="1.4" opacity="0.8" />
      <path d="M44 54 54 40" stroke="#7a5230" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M48 37c4 0 8 2 10 6-3-2-7-3-10-2z" fill="#9aa3ae" stroke="#4d5560" strokeWidth="1" />
      <path d="M26 40h0M38 40h0" stroke="#7a6f66" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  lumberjack: (
    <>
      <Face mouth="open" brows="M24 31l5-1M35 30l5 1" />
      <path d="M20 41c2 12 22 12 24 0-3 2-6 3-12 3s-9-1-12-3z" fill="#9a5a2c" stroke="#6a3b18" strokeWidth="1" />
      <path d="M18 30c0-13 28-13 28 0z" fill="#c0392b" stroke="#7a1d17" strokeWidth="1.2" />
      <path d="M22 22v8M28 19v11M34 19v11M40 22v8" stroke="#7a1d17" strokeWidth="1" opacity="0.6" />
      <path d="M17 30h30" stroke="#2b2622" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M50 54 46 34" stroke="#7a5230" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M44 32c5-4 11-2 12 3-4-1-8 0-11 2z" fill="#c7cdd6" stroke="#4d5560" strokeWidth="1" />
    </>
  ),
  builder: (
    <>
      <Face mouth="smile" brows="M24 30q3-1.5 5 0M35 30q3-1.5 5 0" />
      <path d="M18 30c0-11 28-11 28 0z" fill="#e07a1f" stroke="#8a4710" strokeWidth="1.2" />
      <path d="M16 30h32" stroke="#8a4710" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M30 19h4v11h-4z" fill="#f29a4a" />
      <rect x="40" y="44" width="14" height="7" rx="1" fill="#c65f35" stroke="#7c2c0e" strokeWidth="1" />
      <path d="M47 44v7M40 47.5h14" stroke="#7c2c0e" strokeWidth="0.8" />
      <path d="M8 52 18 42" stroke="#7a5230" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="15" y="37" width="9" height="5" rx="1" fill="#9aa3ae" stroke="#4d5560" strokeWidth="1" transform="rotate(-45 19.5 39.5)" />
    </>
  ),
};

export function EmotePortrait({ emote, size = 44 }) {
  const info = emoteOf(emote);
  if (!info) return null;
  return (
    <svg className={`emote-portrait emote-portrait--${emote}`} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={info.name}>
      <defs>
        <clipPath id={`emote-clip-${emote}`}>
          <circle cx="32" cy="32" r="31" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="31" fill={info.bg} />
      <g clipPath={`url(#emote-clip-${emote})`}>{PORTRAITS[emote]}</g>
      <circle cx="32" cy="32" r="31" fill="none" stroke="rgba(0, 0, 0, 0.12)" strokeWidth="1.5" />
    </svg>
  );
}

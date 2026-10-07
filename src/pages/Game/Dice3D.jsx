import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motionLevel, scaled } from '../../services/motion';

// Two real dice: cubes with six faces that tumble when rolled and come to
// rest showing the numbers the host rolled. The roll is known the moment it
// starts, so the cubes turn straight toward their final faces with a few
// extra spins on the way, and land with a small bounce.

const PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

// Which way each face points, and how to turn the cube to show it.
const FACES = [
  { value: 1, place: 'rotateY(0deg)', show: [0, 0] },
  { value: 6, place: 'rotateY(180deg)', show: [0, 180] },
  { value: 2, place: 'rotateY(90deg)', show: [0, -90] },
  { value: 5, place: 'rotateY(-90deg)', show: [0, 90] },
  { value: 3, place: 'rotateX(90deg)', show: [-90, 0] },
  { value: 4, place: 'rotateX(-90deg)', show: [90, 0] },
];

const showing = (value) => FACES.find((face) => face.value === value)?.show || [0, 0];

function Face({ value, place }) {
  return (
    <span className="die3d-face" style={{ transform: `${place} translateZ(var(--die-half))` }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {PIPS[value].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" />
        ))}
      </svg>
    </span>
  );
}

function Die({ value, spins, delay }) {
  const [x, y] = showing(value || 1);
  // Whole turns are added on every roll so the cube always tumbles forward.
  const turnX = x + spins * 360;
  const turnY = y + spins * 360 * (delay ? -1 : 1);
  return (
    <span className={`die3d ${value ? '' : 'die3d--idle'}`}>
      <span
        className="die3d-cube"
        style={{ transform: `rotateX(${turnX}deg) rotateY(${turnY}deg)`, transitionDelay: `${delay}ms` }}
      >
        {FACES.map((face) => (
          <Face key={face.value} value={face.value} place={face.place} />
        ))}
      </span>
      <span className="die3d-shadow" aria-hidden="true" />
    </span>
  );
}

export default function Dice3D({ dice, rolling, rollKey }) {
  const [spins, setSpins] = useState(0);
  const [landing, setLanding] = useState(false);
  const lastKey = useRef(rollKey);

  useEffect(() => {
    if (rollKey === lastKey.current) return undefined;
    lastKey.current = rollKey;
    if (!rollKey) return undefined;
    setSpins((current) => current + 2);
    setLanding(true);
    const timer = window.setTimeout(() => setLanding(false), 1100);
    return () => window.clearTimeout(timer);
  }, [rollKey]);

  return (
    <div className={`dice3d ${rolling || landing ? 'dice3d--rolling' : ''}`}>
      <Die value={dice?.[0]} spins={spins} delay={0} />
      <Die value={dice?.[1]} spins={spins} delay={90} />
    </div>
  );
}

// The throw: whenever someone rolls, two big dice are thrown onto the
// middle of the board from that player's side, tumble, bounce twice and
// come to rest on the faces the host rolled, with the total popping up
// between them. They then fade, leaving the small pair in the corner.
const THROW_MS = 950;
const STAY_MS = 900;

function ThrownDie({ value, index, fromTop }) {
  const wrap = useRef(null);
  const cube = useRef(null);
  const [x, y] = showing(value);

  useLayoutEffect(() => {
    const duration = scaled(THROW_MS);
    if (!duration) return undefined;
    const side = index ? 1 : -1;
    const startY = fromTop ? -260 : 260;
    const startX = -200 + side * 30;
    const path = wrap.current?.animate?.(
      [
        { transform: `translate(${startX}px, ${startY}px) scale(0.7)`, opacity: 0, easing: 'cubic-bezier(0.3, 0.1, 0.6, 1)' },
        { transform: `translate(${startX * 0.7}px, ${startY * 0.7}px) scale(0.85)`, opacity: 1, offset: 0.12, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
        { transform: 'translate(-34px, 0px) scale(1)', offset: 0.46, easing: 'cubic-bezier(0, 0, 0.4, 1)' },
        { transform: `translate(-14px, ${-38 - index * 6}px) scale(1.04)`, offset: 0.63, easing: 'cubic-bezier(0.5, 0, 1, 1)' },
        { transform: 'translate(-2px, 0px) scale(1)', offset: 0.8, easing: 'cubic-bezier(0, 0, 0.4, 1)' },
        { transform: 'translate(0px, -9px) scale(1)', offset: 0.9, easing: 'cubic-bezier(0.5, 0, 1, 1)' },
        { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
      ],
      { duration, delay: index * 60, fill: 'both' },
    );
    // Tumbling all the way, slowing as it settles on the rolled face.
    const turns = 2 + index;
    const tumble = cube.current?.animate?.(
      [
        { transform: `rotateX(${x + 360 * turns + 40}deg) rotateY(${y - 360 * turns - 70}deg) rotateZ(${index ? -50 : 50}deg)` },
        { transform: `rotateX(${x + 200}deg) rotateY(${y - 160}deg) rotateZ(${index ? -15 : 15}deg)`, offset: 0.5 },
        { transform: `rotateX(${x}deg) rotateY(${y}deg) rotateZ(0deg)` },
      ],
      { duration: duration * 1.05, delay: index * 60, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)', fill: 'both' },
    );
    return () => {
      path?.cancel();
      tumble?.cancel();
    };
  }, [fromTop, index, x, y]);

  return (
    <span className="die3d dice-throw-die" ref={wrap}>
      <span className="die3d-cube" ref={cube} style={{ transform: `rotateX(${x}deg) rotateY(${y}deg)` }}>
        {FACES.map((face) => (
          <Face key={face.value} value={face.value} place={face.place} />
        ))}
      </span>
      <span className="die3d-shadow" aria-hidden="true" />
    </span>
  );
}

export function DiceThrow({ dice, rollKey, fromTop = false }) {
  const [shown, setShown] = useState(null);
  const lastKey = useRef(rollKey);

  useEffect(() => {
    if (rollKey === lastKey.current) return undefined;
    lastKey.current = rollKey;
    if (!rollKey || !dice || motionLevel() === 'off') return undefined;
    setShown({ key: rollKey, dice: [...dice], fromTop });
    const timer = window.setTimeout(() => setShown(null), scaled(THROW_MS) + scaled(STAY_MS) + 400);
    return () => window.clearTimeout(timer);
    // A throw belongs to its roll; the dice and side are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey]);

  if (!shown) return null;
  const total = shown.dice[0] + shown.dice[1];
  return (
    <div
      className="dice-throw"
      key={shown.key}
      aria-hidden="true"
      style={{ '--throw-ms': `${scaled(THROW_MS)}ms`, '--stay-ms': `${scaled(STAY_MS)}ms` }}
    >
      <div className="dice-throw-pair">
        <ThrownDie value={shown.dice[0]} index={0} fromTop={shown.fromTop} />
        <ThrownDie value={shown.dice[1]} index={1} fromTop={shown.fromTop} />
      </div>
      <span className={`dice-throw-total ${total === 7 ? 'dice-throw-total--seven' : ''}`}>{total}</span>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

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

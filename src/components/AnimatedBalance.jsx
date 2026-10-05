import { useEffect, useRef, useState } from 'react';

const formatRupees = (amount) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

// A balance that counts up or down to its new value instead of jumping, with
// the change floating up beside it in green or red, so every payment from a
// card, rent or purchase is visible as it happens.
export default function AnimatedBalance({ value, className = '' }) {
  const [shown, setShown] = useState(value);
  const [deltas, setDeltas] = useState([]);
  const [trend, setTrend] = useState('');
  const previous = useRef(value);
  const shownRef = useRef(value);
  const timers = useRef(new Set());

  useEffect(() => {
    const delta = value - previous.current;
    previous.current = value;

    if (delta === 0) {
      return undefined;
    }

    const id = `${Date.now()}${Math.random()}`;
    setDeltas((list) => [...list.slice(-2), { id, delta }]);
    setTrend(delta > 0 ? 'up' : 'down');

    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setDeltas((list) => list.filter((entry) => entry.id !== id));
      setTrend('');
    }, 1900);
    timers.current.add(timer);

    const from = shownRef.current;
    const duration = Math.min(1500, 600 + Math.abs(delta) / 500);
    const start = performance.now();
    let frame;

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (value - from) * eased;
      shownRef.current = next;
      setShown(next);

      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  return (
    <span className={`animated-balance ${trend ? `animated-balance--${trend}` : ''} ${className}`.trim()}>
      <span className="animated-balance-value">{formatRupees(shown)}</span>
      {deltas.map((entry) => (
        <span
          key={entry.id}
          className={`balance-float ${entry.delta > 0 ? 'balance-float--gain' : 'balance-float--loss'}`}
          aria-live="polite"
        >
          {entry.delta > 0 ? '+' : '−'}
          {formatRupees(Math.abs(entry.delta))}
        </span>
      ))}
    </span>
  );
}

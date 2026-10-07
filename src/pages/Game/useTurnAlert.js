import { useEffect, useRef } from 'react';

// When the game is in a background tab and it needs you (your turn, a
// discard, an offer waiting on your answer), the tab's title flashes and,
// if you allowed it, the browser shows a notification. Both stop the
// moment you come back.
export default function useTurnAlert(reason) {
  const original = useRef(typeof document !== 'undefined' ? document.title : '');
  const last = useRef(null);

  useEffect(() => {
    if (!reason || reason === last.current) {
      if (!reason) last.current = null;
      return undefined;
    }
    last.current = reason;
    if (!document.hidden) return undefined;

    const base = original.current || 'Catan';
    let on = false;
    const flash = window.setInterval(() => {
      on = !on;
      document.title = on ? `● ${reason}` : base;
    }, 1000);
    document.title = `● ${reason}`;

    let note = null;
    try {
      if (window.Notification?.permission === 'granted') note = new window.Notification('Catan', { body: reason, tag: 'catan-turn' });
    } catch {
      // Some browsers only notify from a service worker; the title still flashes.
    }

    const stop = () => {
      window.clearInterval(flash);
      document.title = base;
      note?.close?.();
    };
    const onVisible = () => !document.hidden && stop();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [reason]);
}

// Ask once, from a click, whether the browser may notify on your turn.
export const askToNotify = async () => {
  try {
    if (!window.Notification || window.Notification.permission !== 'default') return window.Notification?.permission || 'denied';
    return await window.Notification.requestPermission();
  } catch {
    return 'denied';
  }
};

// How much the game moves. The cards, dice and dragon are how the table
// tells you what happened, so they play in full by default, even when the
// computer asks for reduced motion (Windows turns that on whenever its
// "Animation effects" switch is off, which many laptops ship with). A player
// can still choose Gentle (shorter, no bounce) or Off. The choice is kept on
// this device and set as data-motion on <html>, which the CSS keys from.

const KEY = 'catan-motion';
export const MOTION_LEVELS = ['full', 'gentle', 'off'];
const listeners = new Set();

// Shared timings (ms) and easings, the same values as the CSS variables.
export const MOTION = { fast: 180, base: 320, slow: 600, flight: 820, harvest: 1300 };
export const EASE = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
};

const saved = () => {
  try {
    const value = window.localStorage.getItem(KEY);
    return MOTION_LEVELS.includes(value) ? value : null;
  } catch {
    return null;
  }
};

export const motionLevel = () => {
  if (typeof document === 'undefined') return 'full';
  const current = document.documentElement.dataset.motion;
  return MOTION_LEVELS.includes(current) ? current : saved() || 'full';
};

// How long something takes at the chosen level; 0 means do not animate.
export const scaled = (ms) => {
  const level = motionLevel();
  if (level === 'off') return 0;
  return level === 'gentle' ? Math.round(ms * 0.6) : ms;
};

const apply = (level) => {
  document.documentElement.dataset.motion = level;
  listeners.forEach((fn) => fn(level));
};

export const setMotion = (level) => {
  if (!MOTION_LEVELS.includes(level)) return;
  try {
    window.localStorage.setItem(KEY, level);
  } catch {
    // Private windows may block storage; the choice still applies now.
  }
  apply(level);
};

export const onMotionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const initMotion = () => apply(saved() || 'full');

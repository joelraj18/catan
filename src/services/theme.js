// Light and dark themes. A choice the player makes is kept on this device;
// until they make one, the page follows the system setting, live. The theme
// is a data attribute on <html>, which dark.css keys every override from.

const KEY = 'catan-theme';
const META_COLOUR = { light: '#f5f6f1', dark: '#0b0f0c' };
const listeners = new Set();

const saved = () => {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
};

const systemTheme = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export const getTheme = () => document.documentElement.dataset.theme || saved() || systemTheme();

const apply = (theme) => {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOUR[theme]);
  listeners.forEach((fn) => fn(theme));
};

export const setTheme = (theme) => {
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Private windows may block storage; the theme still applies now.
  }
  apply(theme);
};

export const onThemeChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Runs once at start up: settle the theme, then follow the system while the
// player has not chosen one.
export const initTheme = () => {
  apply(saved() || systemTheme());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!saved()) apply(systemTheme());
  });
};

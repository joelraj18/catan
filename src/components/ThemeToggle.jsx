import { useEffect, useState } from 'react';
import { getTheme, onThemeChange, setTheme } from '../services/theme';

// A sun and moon button that flips between the light and dark themes.
export default function ThemeToggle({ className = '' }) {
  const [theme, setLocal] = useState(getTheme);

  useEffect(() => onThemeChange(setLocal), []);

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Light mode' : 'Dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      aria-pressed={dark}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
          </>
        ) : (
          <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" />
        )}
      </svg>
    </button>
  );
}

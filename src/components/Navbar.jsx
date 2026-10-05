import { useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';
import GoldButton from './GoldButton';
import SoundMixer from './SoundMixer';
import ThemeToggle from './ThemeToggle';

const sectionLinks = [
  { id: 'overview', label: 'Overview' },
  { id: 'pieces', label: 'Colours' },
  { id: 'how-to-play', label: 'How to play' },
  { id: 'board-guide', label: 'The island' },
  { id: 'tips', label: 'Tips' },
  { id: 'faq', label: 'FAQ' },
];

export default function Navbar({ audio, onAudio, onNavigate, onPlay }) {
  const [isStuck, setIsStuck] = useState(false);

  // The brand bar sits first and stays on top; it frosts once the page
  // scrolls under it.
  useEffect(() => {
    const onScroll = () => setIsStuck(window.scrollY > 8);

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <div className={`local-nav ${isStuck ? 'local-nav--stuck' : ''}`}>
        <div className="local-nav-inner">
          <button className="local-nav-title" type="button" onClick={() => onNavigate('top')} aria-label="Catan home">
            <BrandLogo size={22} showWordmark />
          </button>

          <div className="local-nav-actions">
            <button type="button" className="local-nav-link" onClick={() => onNavigate('how-to-play')}>
              Guide
            </button>

            <button type="button" className="local-nav-link" onClick={() => onNavigate('faq')}>
              FAQ
            </button>

            <SoundMixer audio={audio} onAudio={onAudio} />
            <ThemeToggle />

            <GoldButton size="small" onClick={onPlay}>
              Play
            </GoldButton>
          </div>
        </div>
      </div>

      <header className="global-nav">
        <nav className="global-nav-inner global-nav-links" aria-label="Sections">
          {sectionLinks.map((link) => (
            <button key={link.id} type="button" onClick={() => onNavigate(link.id)}>
              {link.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="ribbon">
        <p>
          Play free in your browser with friends anywhere, or with computer opponents{' '}
          <button type="button" className="text-link" onClick={onPlay}>
            Start game <span aria-hidden="true">›</span>
          </button>
        </p>
      </div>
    </>
  );
}

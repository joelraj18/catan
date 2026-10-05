import { useCallback, useEffect, useRef, useState } from 'react';

// A horizontal shelf of cards with scroll snapping and round paddle buttons,
// modelled on the Apple Store product shelves.
export default function Carousel({ label, children, className = '' }) {
  const trackRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(true);

  const syncPaddles = useCallback(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    setCanGoBack(track.scrollLeft > 4);
    setCanGoForward(track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return undefined;
    }

    syncPaddles();
    track.addEventListener('scroll', syncPaddles, { passive: true });
    window.addEventListener('resize', syncPaddles);

    return () => {
      track.removeEventListener('scroll', syncPaddles);
      window.removeEventListener('resize', syncPaddles);
    };
  }, [syncPaddles]);

  const page = (direction) => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const card = track.querySelector('.carousel-item');
    const step = card ? card.getBoundingClientRect().width + 20 : track.clientWidth * 0.8;

    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  return (
    <div className={`carousel ${className}`.trim()}>
      <div className="carousel-track" ref={trackRef} role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>

      <div className="carousel-paddles">
        <button
          type="button"
          className="carousel-paddle"
          onClick={() => page(-1)}
          disabled={!canGoBack}
          aria-label="Previous"
        >
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <path d="M21.5 11 14.5 18l7 7" />
          </svg>
        </button>

        <button
          type="button"
          className="carousel-paddle"
          onClick={() => page(1)}
          disabled={!canGoForward}
          aria-label="Next"
        >
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <path d="m14.5 11 7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

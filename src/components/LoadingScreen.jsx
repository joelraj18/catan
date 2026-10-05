import { useEffect, useState } from 'react';
import { BrandMark } from './BrandLogo';

export default function LoadingScreen({ onComplete }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((currentProgress) => {
        if (currentProgress >= 100) {
          window.clearInterval(timer);

          window.setTimeout(() => {
            onComplete();
          }, 260);

          return 100;
        }

        return Math.min(100, currentProgress + 5);
      });
    }, 32);

    return () => {
      window.clearInterval(timer);
    };
  }, [onComplete]);

  return (
    <div className={`loading-screen ${progress >= 100 ? 'loading-screen--done' : ''}`}>
      <BrandMark size={72} className="loading-mark" />

      <div
        className="loading-track"
        role="progressbar"
        aria-label="Loading Catan"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progress}
      >
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
    </div>
  );
}

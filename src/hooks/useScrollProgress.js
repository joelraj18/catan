import { useEffect } from 'react';

// Writes a 0 to 1 scroll progress for the element into the --scroll custom
// property, measured from when its top reaches the viewport top until it has
// scrolled a given share of its own height. Updates are batched per frame.
export default function useScrollProgress(elementRef, distance = 0.6) {
  useEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return undefined;
    }

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const travel = Math.max(1, rect.height * distance);
      const progress = Math.min(1, Math.max(0, -rect.top / travel));
      element.style.setProperty('--scroll', progress.toFixed(4));
    };

    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [elementRef, distance]);
}

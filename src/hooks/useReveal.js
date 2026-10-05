import { useEffect } from 'react';

// Adds .is-visible to every .reveal element inside the given root once it
// scrolls into view, so sections glide in the way Apple product pages do.
// Each element is revealed once and then left alone. Pass a key that changes
// whenever the root remounts so the new elements are observed too.
export default function useReveal(rootRef, key) {
  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return undefined;
    }

    const targets = Array.from(root.querySelectorAll('.reveal'));

    if (!('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    );

    targets.forEach((target) => observer.observe(target));

    return () => observer.disconnect();
  }, [rootRef, key]);
}

import { useRef } from 'react';

// The newest event of one type that happened while this board was open, or
// null. Events from before the board opened (a reload, a reconnect) are
// history, not news, so they never replay their animation.
export default function useFreshEvent(events, type) {
  const firstSeen = useRef(null);
  const list = Array.isArray(events) ? events : [];
  if (firstSeen.current === null) firstSeen.current = list.length ? list[list.length - 1].id : 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].id <= firstSeen.current) return null;
    if (list[i].type === type) return list[i];
  }
  return null;
}

import { useEffect, useRef } from 'react';
import goodTimesMusic from '../assets/music/The Good Times.mp3';

export default function AmbientMusic({
  isPlaying,
  volume = 0.7,
  onPlaybackBlocked,
}) {
  const audioReference = useRef(null);

  useEffect(() => {
    const audio = audioReference.current;

    if (!audio) {
      return undefined;
    }

    audio.loop = true;

    if (isPlaying) {
      audio.play().catch(() => {
        onPlaybackBlocked?.();
      });
    } else {
      audio.pause();
    }

    return undefined;
  }, [isPlaying, onPlaybackBlocked]);

  // The music slider maps onto a gentler range so full volume never drowns
  // out the game sounds.
  useEffect(() => {
    if (audioReference.current) {
      audioReference.current.volume = Math.min(1, Math.max(0, volume * 0.6));
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioReference.current;

    return () => {
      audio?.pause();
    };
  }, []);

  return (
    <audio
      ref={audioReference}
      src={goodTimesMusic}
      preload="metadata"
    />
  );
}
import { useEffect, useRef, useState } from 'react';

// One speaker button that opens a small mixer with two independent channels:
// background music and game sound effects, each with its own switch and
// slider. The pop-up closes on Escape or a click elsewhere.
function Channel({ id, label, hint, enabled, volume, onChange }) {
  const level = Math.round(volume * 100);

  return (
    <div className={`mixer-channel ${enabled ? 'mixer-channel--on' : ''}`}>
      <div className="mixer-channel-head">
        <div>
          <span className="mixer-label" id={`${id}-label`}>
            {label}
          </span>
          <span className="mixer-hint">{enabled ? `${level}%` : hint}</span>
        </div>

        <button
          type="button"
          role="switch"
          className="mixer-switch"
          aria-checked={enabled}
          aria-labelledby={`${id}-label`}
          onClick={() => onChange({ enabled: !enabled })}
        >
          <span />
        </button>
      </div>

      <input
        type="range"
        className="mixer-slider"
        min="0"
        max="100"
        step="1"
        value={level}
        style={{ '--level': `${level}%` }}
        aria-label={`${label} volume`}
        aria-valuetext={`${level} percent`}
        onChange={(event) => {
          const next = Number(event.target.value) / 100;
          // Dragging up turns the channel on, dragging to zero turns it off.
          onChange({ volume: next, enabled: next > 0 });
        }}
      />
    </div>
  );
}

export default function SoundMixer({ audio, onAudio, className = '', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const anyOn = (audio.musicOn && audio.musicVolume > 0) || (audio.effectsOn && audio.effectsVolume > 0);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);

    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  return (
    <div className={`sound-mixer sound-mixer--${align} ${open ? 'sound-mixer--open' : ''} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`sound-mixer-button ${anyOn ? 'sound-mixer-button--on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Sound settings"
        title="Sound settings"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path className="mixer-icon-body" d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
          {anyOn ? (
            <>
              <path d="M15.5 9a4 4 0 0 1 0 6" />
              <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
            </>
          ) : (
            <path d="m16 9.5 5 5m0-5-5 5" />
          )}
        </svg>
      </button>

      <div className="sound-mixer-panel" role="dialog" aria-label="Sound settings" aria-hidden={!open}>
        <p className="sound-mixer-title">Sound</p>

        <Channel
          id="mixer-music"
          label="Music"
          hint="The Good Times soundtrack"
          enabled={audio.musicOn}
          volume={audio.musicVolume}
          onChange={({ enabled, volume }) =>
            onAudio({
              musicOn: enabled,
              ...(volume !== undefined && volume > 0 ? { musicVolume: volume } : {}),
            })
          }
        />

        <Channel
          id="mixer-effects"
          label="Sound effects"
          hint="Purchases, express trains and the crown"
          enabled={audio.effectsOn}
          volume={audio.effectsVolume}
          onChange={({ enabled, volume }) =>
            onAudio({
              effectsOn: enabled,
              ...(volume !== undefined && volume > 0 ? { effectsVolume: volume } : {}),
            })
          }
        />
      </div>
    </div>
  );
}

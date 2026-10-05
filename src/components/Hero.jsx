import { useRef } from 'react';
import useScrollProgress from '../hooks/useScrollProgress';
import { BOARD_GRID, BOARD_SPACES } from '../pages/Game/boardData';
import { PieceMark } from '../pages/Game/pieces.jsx';
import { BrandMark } from './BrandLogo';
import GoldButton from './GoldButton';

// Where the showcase tokens rest on the preview board.
const showcaseTokens = [
  { piece: 'lamp', space: 0 },
  { piece: 'temple', space: 13 },
  { piece: 'elephant', space: 24 },
  { piece: 'bell', space: 37 },
];

const DIE_PIPS = {
  5: [
    [25, 25],
    [75, 25],
    [50, 50],
    [25, 75],
    [75, 75],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
};

function Die({ value }) {
  return (
    <svg className="hero-die" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="24" />
      {DIE_PIPS[value].map(([cx, cy]) => (
        <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="8.5" />
      ))}
    </svg>
  );
}

function BoardPreview() {
  return (
    <div className="board-slab">
      <div className="board-slab-sheen" aria-hidden="true" />

      <div className="preview-board">
        {BOARD_SPACES.map((space) => {
          const [column, row] = BOARD_GRID[space.id];
          const token = showcaseTokens.find((entry) => entry.space === space.id);
          const isCorner = space.id % 10 === 0;

          return (
            <span
              key={space.id}
              className={`preview-tile preview-tile--${space.type} ${
                isCorner ? 'preview-tile--corner' : ''
              }`}
              style={{
                gridColumn: column,
                gridRow: row,
                '--tile-colour': space.colorGroup
                  ? `var(--color-${space.colorGroup})`
                  : 'transparent',
              }}
            >
              {token && (
                <span className={`preview-token seat-${token.piece}`}>
                  <PieceMark piece={token.piece} variant="token" />
                </span>
              )}
            </span>
          );
        })}

        <div className="preview-centre">
          <BrandMark size={58} />
          <strong>Manapally</strong>
          <span>40 spaces of South Indian legend</span>
        </div>
      </div>
    </div>
  );
}

export default function Hero({ onCreateRoom, onExplore }) {
  const heroRef = useRef(null);

  useScrollProgress(heroRef, 0.55);

  return (
    <section className="hero" id="top" ref={heroRef} aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="hero-kicker">New season</p>

        <h1 id="hero-heading" className="hero-title">
          Manapally
        </h1>

        <p className="hero-subtitle">Premium South Indian Strategy Board Game</p>

        <p className="hero-description">
          Collect the cities of Andhra Pradesh and Telangana from Koti to Jubilee, ride
          the express stations and outplay your circle in one beautifully paced match
        </p>

        <div className="hero-actions">
          <GoldButton onClick={onCreateRoom}>Start game</GoldButton>

          <button type="button" className="text-link text-link--large" onClick={onExplore}>
            Learn how to play <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <div className="hero-stage" role="img" aria-label="A preview of the Manapally game board in sage green">
        <div className="hero-glow" aria-hidden="true" />

        <div className="hero-visual">
          <BoardPreview />

          <div className="hero-dice" aria-hidden="true">
            <Die value={5} />
            <Die value={3} />
          </div>
        </div>
      </div>
    </section>
  );
}

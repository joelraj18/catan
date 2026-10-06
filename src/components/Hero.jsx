import { useMemo, useRef } from 'react';
import useScrollProgress from '../hooks/useScrollProgress';
import { beginnerBoard } from '../pages/Game/catanBoard';
import { beginnerPieces } from '../pages/Game/catanEngine';
import HexBoard from '../pages/Game/hexArt.jsx';
import GoldButton from './GoldButton';

// The beginners' island from the rulebook, with all four colours set up.
const PREVIEW_PLAYERS = ['red', 'blue', 'white', 'orange'].map((pieceKey, index) => ({
  id: `p${index + 1}`,
  name: pieceKey,
  pieceKey,
}));

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
  const preview = useMemo(() => {
    const board = beginnerBoard();
    return { board, ...beginnerPieces(PREVIEW_PLAYERS, board) };
  }, []);

  return (
    <div className="board-slab board-slab--hex">
      <div className="board-slab-sheen" aria-hidden="true" />
      <HexBoard
        board={preview.board}
        buildings={preview.buildings}
        roads={preview.roads}
        players={PREVIEW_PLAYERS}
        compact
        label="The beginners' island of Catan with four colours set up"
      />
    </div>
  );
}

export default function Hero({ onCreateRoom, onExplore }) {
  const heroRef = useRef(null);

  useScrollProgress(heroRef, 0.55);

  return (
    <section className="hero" id="top" ref={heroRef} aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="hero-kicker">3 to 4 players</p>

        <h1 id="hero-heading" className="hero-title">
          Catan
        </h1>

        <p className="hero-subtitle">Settle the island, trade and build</p>

        <p className="hero-description">
          Gather brick, lumber, ore, grain and wool, trade with your friends and race to 10 victory points with roads,
          settlements and cities
        </p>

        <div className="hero-actions">
          <GoldButton onClick={onCreateRoom}>Start game</GoldButton>

          <button type="button" className="text-link text-link--large" onClick={onExplore}>
            Learn how to play <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <div className="hero-stage">
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

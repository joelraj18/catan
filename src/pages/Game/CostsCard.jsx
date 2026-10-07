import { RESOURCE_LABELS } from './catanBoard';
import { COSTS } from './catanRules';
import { ResourceIcon } from './hexArt.jsx';
import { DevBack } from './GameCards.jsx';
import { City3D, PIECES, Settlement3D } from './pieces.jsx';

// The building costs card from the box, kept beside the board: each piece,
// what it is worth and the cards it takes, in the order the rulebook prints
// them (road, settlement, city, development card). Cards you hold are ticked,
// rows your hand pays for light up, and on your turn a row picks up that
// piece, just like the buttons under the board.

const ROWS = [
  { kind: 'road', label: 'Road', worth: '= 0 VP', order: ['brick', 'lumber'] },
  { kind: 'settlement', label: 'Settlement', worth: '= 1 VP', order: ['brick', 'lumber', 'grain', 'wool'] },
  { kind: 'city', label: 'City', worth: '= 2 VPs', order: ['grain', 'ore'] },
  { kind: 'dev', label: 'Development card', worth: '= ? VPs', order: ['wool', 'grain', 'ore'] },
];

// One card per resource needed: city is grain, grain, ore, ore, ore.
const cardsFor = (kind, order) => order.flatMap((resource) => Array.from({ length: COSTS[kind][resource] || 0 }, () => resource));

function PieceGlyph({ kind, colour }) {
  if (kind === 'dev') return <DevBack size={20} />;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {kind === 'road' && (
        <g strokeLinecap="round">
          <line x1="3" y1="16" x2="21" y2="8" stroke={colour.edge} strokeWidth="6.5" />
          <line x1="3" y1="15" x2="21" y2="7" stroke={colour.fill} strokeWidth="4.2" />
          <line x1="3.5" y1="14" x2="20.5" y2="6.3" stroke={colour.light} strokeWidth="1.2" />
        </g>
      )}
      {kind === 'settlement' && <Settlement3D colour={colour} shadow={false} />}
      {kind === 'city' && <City3D colour={colour} shadow={false} />}
    </svg>
  );
}

export default function CostsCard({ hand = null, ready = {}, active = null, piece = 'red', onPick = null }) {
  const colour = PIECES[piece] || PIECES.red;
  return (
    <section className="costs-card" aria-label="Building costs">
      <h3 className="costs-card-title">Building Costs</h3>
      <ol className="costs-card-rows">
        {ROWS.map(({ kind, label, worth, order }) => {
          // Tick off the cards this hand already holds, one by one.
          const left = { ...(hand || {}) };
          const cards = cardsFor(kind, order).map((resource) => {
            const have = (left[resource] || 0) > 0;
            if (have) left[resource] -= 1;
            return { resource, have };
          });
          const canPick = Boolean(onPick && ready[kind]);
          const Row = canPick ? 'button' : 'div';
          return (
            <li key={kind}>
              <Row
                {...(canPick ? { type: 'button', onClick: () => onPick(kind), 'aria-pressed': active === kind } : {})}
                className={`costs-row costs-row--${kind} ${ready[kind] ? 'costs-row--ready' : ''} ${active === kind ? 'costs-row--active' : ''}`}
                aria-label={`${label}, ${worth.replace('=', 'worth').replace('VPs', 'victory points').replace('VP', 'victory point')}. Costs ${cards
                  .map(({ resource }) => RESOURCE_LABELS[resource].toLowerCase())
                  .join(', ')}${canPick ? '. Pick it up' : ''}`}
              >
                <span className="costs-row-name">
                  <strong>{label}</strong>
                  <span className="costs-row-worth">
                    <PieceGlyph kind={kind} colour={colour} />
                    {worth}
                  </span>
                </span>
                <span className="costs-row-cards">
                  {cards.map(({ resource, have }, index) => (
                    <span key={`${resource}-${index}`} className={`costs-tile res-${resource} ${have && hand ? 'costs-tile--have' : ''}`} title={RESOURCE_LABELS[resource]}>
                      <ResourceIcon resource={resource} size={15} />
                    </span>
                  ))}
                </span>
              </Row>
            </li>
          );
        })}
      </ol>
      <ul className="costs-card-notes">
        <li>A City replaces an already-built Settlement.</li>
        <li>Play one development card per turn, never on the turn it is bought.</li>
      </ul>
    </section>
  );
}

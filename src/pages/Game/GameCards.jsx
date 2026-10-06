import { RESOURCES, RESOURCE_LABELS } from './catanBoard';
import { DEV_CARDS } from './catanRules';
import { ResourceIcon } from './hexArt.jsx';

// Cards drawn like real ones: upright, with the resource or card symbol on a
// coloured face, the count on a badge and a small stack behind when there is
// more than one. Every kind of card in the hand is in view at once.

// Development card art, one symbol each, drawn in currentColor.
const DEV_ART = {
  knight: (
    <>
      <path d="M12 2.5 19.5 5v6.2c0 4.6-3.2 8.4-7.5 10.3C7.7 19.6 4.5 15.8 4.5 11.2V5z" />
      <path d="M12 6.5v10M8.5 10h7" className="resource-icon-line resource-icon-line--bold" />
    </>
  ),
  roadBuilding: (
    <>
      <path d="m3.5 17.5 7-11" className="dev-road" />
      <path d="m11.5 19.5 9-13" className="dev-road" />
      <path d="m3.5 17.5 7-11M11.5 19.5l9-13" className="dev-road-line" />
    </>
  ),
  yearOfPlenty: (
    <>
      <path d="M3 9.5c4.5 0 8.5 2.5 10.5 6.5l2.6-1.4C13.6 9.4 9 6.5 3 6.5z" />
      <path d="M13.5 16c1.2 2.3 3.4 3.8 6 3.8.9 0 1.5-.6 1.5-1.4v-5.8c0-.8-.6-1.4-1.4-1.3-2.3.2-4.1 1.3-5.2 2.9z" />
      <circle cx="17.5" cy="15.6" r="1.6" className="resource-icon-light" />
      <circle cx="6.5" cy="4.5" r="1.4" />
      <circle cx="10.2" cy="3.4" r="1.2" />
    </>
  ),
  monopoly: (
    <>
      <path d="M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5-1.8 10H5.3z" />
      <path d="M5.3 20.5h13.4" className="resource-icon-line resource-icon-line--bold" />
      <circle cx="12" cy="14.6" r="1.6" className="resource-icon-light" />
    </>
  ),
  victoryPoint: (
    <>
      <path d="m12 2.8 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </>
  ),
};

export function DevArt({ type, size = 24 }) {
  return (
    <svg className={`dev-art dev-art--${type}`} viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      {DEV_ART[type] || DEV_ART.victoryPoint}
    </svg>
  );
}

export function ResourceCard({ resource, count, compact = false }) {
  return (
    <li
      className={`game-card game-card--${resource} ${count ? '' : 'game-card--empty'} ${count > 1 ? 'game-card--stack' : ''} ${compact ? 'game-card--compact' : ''}`}
      title={`${count} ${RESOURCE_LABELS[resource]}`}
      data-anchor={`hand-${resource}`}
    >
      <span className="game-card-face">
        <span className="game-card-art">
          <ResourceIcon resource={resource} size={compact ? 20 : 26} />
        </span>
      </span>
      <span className="game-card-name">{RESOURCE_LABELS[resource]}</span>
      <strong className="game-card-count" aria-label={`${count} ${RESOURCE_LABELS[resource]}`}>
        {count}
      </strong>
    </li>
  );
}

// The resource cards of a hand, one upright card per kind, in a row.
export function ResourceRow({ hand, compact = false }) {
  return (
    <ul className="card-row" aria-label="Resource cards">
      {RESOURCES.map((resource) => (
        <ResourceCard key={resource} resource={resource} count={hand?.[resource] || 0} compact={compact} />
      ))}
    </ul>
  );
}

// Development cards grouped by kind. A card bought this turn waits a turn;
// before the roll only a Knight may be played.
export function DevRow({ cards, turnCount, canPlay, playable, onPlay, selected = null, deck = null }) {
  const groups = [];
  ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'].forEach((type) => {
    const ofType = cards.filter((card) => card.type === type);
    if (!ofType.length) return;
    const ready = ofType.filter((card) => card.boughtTurn !== turnCount);
    const fresh = ofType.length - ready.length;
    groups.push({ type, count: ofType.length, ready: ready.length, fresh });
  });

  if (!groups.length && !deck) return null;

  return (
    <ul className="card-row card-row--dev" aria-label="Development cards">
      {deck && (
        <li className="deck-slot">
          <div className={`game-card game-card--deck ${deck.left > 1 ? 'game-card--stack' : ''}`}>
            <button
              type="button"
              className={`game-card-face game-card-button ${deck.selected ? 'game-card-button--selected' : ''}`}
              disabled={!deck.ready}
              onClick={deck.onBuy}
              title="Buy a development card: 1 ore, 1 wool, 1 grain"
              aria-label={`Buy a development card, ${deck.left} left. Costs 1 ore, 1 wool and 1 grain${deck.note ? `. ${deck.note}` : ''}${deck.selected ? '. Tap again to buy' : ''}`}
            >
              <span className="game-card-art">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" className="deck-plus" />
                </svg>
              </span>
              <em className="game-card-note">{deck.selected ? 'Tap again' : deck.ready ? 'Buy' : deck.note || `${deck.left} left`}</em>
            </button>
            <span className="game-card-name">Buy card</span>
          </div>
          {deck.cost && (
            <ul className="deck-cost" aria-hidden="true">
              {Object.entries(deck.cost).map(([resource, count]) => {
                const have = (deck.hand?.[resource] || 0) >= count;
                return (
                  <li key={resource} className={`deck-cost-card game-card--${resource} ${have ? 'deck-cost-card--have' : ''}`}>
                    <ResourceIcon resource={resource} size={12} />
                    <span>{have ? '✓' : count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      )}
      {groups.map(({ type, count, ready, fresh }) => {
        const info = DEV_CARDS[type];
        const isVp = type === 'victoryPoint';
        const canUse = !isVp && canPlay && playable.some((card) => card.type === type);
        const note = isVp ? '1 VP' : !ready ? 'Next turn' : canUse ? (selected === type ? 'Tap again' : 'Play') : '';
        return (
          <li key={type} className={`game-card game-card--dev game-card--${type} ${count > 1 ? 'game-card--stack' : ''}`}>
            <button
              type="button"
              className={`game-card-face game-card-button ${selected === type ? 'game-card-button--selected' : ''}`}
              disabled={!canUse}
              onClick={() => onPlay(type)}
              title={info?.text}
              aria-label={`${info?.label}${count > 1 ? `, ${count} cards` : ''}${fresh ? `, ${fresh} playable next turn` : ''}. ${info?.text}`}
            >
              <span className="game-card-art">
                <DevArt type={type} size={26} />
              </span>
              {note && <em className="game-card-note">{note}</em>}
            </button>
            <span className="game-card-name">{info?.label}</span>
            {count > 1 && <strong className="game-card-count">{count}</strong>}
          </li>
        );
      })}
    </ul>
  );
}

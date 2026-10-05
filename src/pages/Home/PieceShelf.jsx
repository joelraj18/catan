import Carousel from '../../components/Carousel';
import GoldButton from '../../components/GoldButton';
import { RESOURCE_LABELS } from '../Game/catanBoard';
import { COSTS, PIECE_LIMITS } from '../Game/catanRules';
import { ResourceIcon } from '../Game/hexArt.jsx';
import { PIECES, PIECE_ORDER, PieceMark } from '../Game/pieces.jsx';

const colourStories = {
  red: 'Bold expansion, for players who race for the Longest Road',
  blue: 'Steady and calm, for players who build cities and wait for the right roll',
  white: 'Quiet and watchful, for players who trade hard and strike late',
  orange: 'Warm and lively, for players who love the knights and the robber',
};

const builds = [
  { key: 'road', name: 'Road', cost: COSTS.road, points: '0 VP', note: 'Connects your network, 5+ in a row can take the Longest Road' },
  { key: 'settlement', name: 'Settlement', cost: COSTS.settlement, points: '1 VP', note: 'Needs a road and the Distance Rule' },
  { key: 'city', name: 'City', cost: COSTS.city, points: '2 VP', note: 'Upgrades a settlement and doubles its production' },
  { key: 'dev', name: 'Development card', cost: COSTS.dev, points: '?', note: 'A knight, a progress card or a hidden victory point' },
];

export default function PieceShelf({ onPlay }) {
  return (
    <section className="home-section home-section--shelf" id="pieces" aria-labelledby="pieces-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="pieces-heading">
            Pick a colour <span>And learn what everything costs</span>
          </h2>
        </header>
      </div>

      <Carousel label="Choose a colour" className="reveal">
        {PIECE_ORDER.map((key) => {
          const piece = PIECES[key];

          return (
            <article className="carousel-item piece-card" key={key} style={{ '--piece': piece.colour }}>
              <h3>{piece.label}</h3>
              <p className="piece-card-label">
                {PIECE_LIMITS.road} roads · {PIECE_LIMITS.settlement} settlements · {PIECE_LIMITS.city} cities
              </p>

              <div className="piece-card-visual">
                <span className="piece-card-halo" aria-hidden="true" />
                <PieceMark piece={key} variant="token" title={piece.label} />
              </div>

              <ul className="piece-card-swatches" aria-label="Player colours">
                {PIECE_ORDER.map((swatch) => (
                  <li
                    key={swatch}
                    className={swatch === key ? 'is-current' : ''}
                    style={{ '--swatch': PIECES[swatch].colour }}
                    title={PIECES[swatch].label}
                  />
                ))}
              </ul>

              <p className="piece-card-story">{colourStories[key]}</p>

              <div className="piece-card-foot">
                <span>{piece.label} seat</span>
                <GoldButton size="small" onClick={() => onPlay(key)}>
                  Play
                </GoldButton>
              </div>
            </article>
          );
        })}

        <article className="carousel-item piece-card piece-card--note piece-card--costs">
          <p className="eyebrow">Building costs</p>
          <h3>What you can build</h3>
          <ul className="cost-card-list">
            {builds.map((build) => (
              <li key={build.key}>
                <div>
                  <strong>{build.name}</strong>
                  <span>{build.points}</span>
                </div>
                <span className="cost-chips">
                  {Object.entries(build.cost).map(([resource, count]) =>
                    Array.from({ length: count }, (_, i) => (
                      <span key={`${resource}${i}`} className={`cost-chip res-${resource}`} title={RESOURCE_LABELS[resource]}>
                        <ResourceIcon resource={resource} size={13} />
                      </span>
                    )),
                  )}
                </span>
                <p>{build.note}</p>
              </li>
            ))}
          </ul>
          <GoldButton variant="ghost" size="small" onClick={() => onPlay('red')}>
            Start a game
          </GoldButton>
        </article>
      </Carousel>
    </section>
  );
}

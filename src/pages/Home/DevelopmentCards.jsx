import Icon from '../../components/Icon';
import { DEV_CARDS, DEV_DECK } from '../Game/catanRules';

const cards = [
  {
    key: 'knight',
    icon: 'shield',
    tone: 'knight',
    count: DEV_DECK.knight,
    detail: 'Played knights stay in front of you. The first to 3 takes the Largest Army',
  },
  {
    key: 'roadBuilding',
    icon: 'road',
    tone: 'progress',
    count: DEV_DECK.roadBuilding,
    detail: 'Following the normal building rules',
  },
  {
    key: 'yearOfPlenty',
    icon: 'grain',
    tone: 'progress',
    count: DEV_DECK.yearOfPlenty,
    detail: 'You may use them to build in the same turn',
  },
  {
    key: 'monopoly',
    icon: 'coins',
    tone: 'progress',
    count: DEV_DECK.monopoly,
    detail: 'Players without that resource give nothing',
  },
  {
    key: 'victoryPoint',
    icon: 'crown',
    tone: 'victory',
    count: DEV_DECK.victoryPoint,
    detail: 'Revealed when it wins the game, and may be counted the turn it is bought',
  },
];

const specials = [
  {
    title: 'Longest Road',
    text: 'The first continuous road of 5 or more segments is worth 2 victory points. A longer road takes the card, and an opponent’s settlement can break a road in two',
    icon: 'road',
  },
  {
    title: 'Largest Army',
    text: 'The first player with 3 knights in play gets 2 victory points. Play more knights than the holder to take the card',
    icon: 'shield',
  },
];

export default function DevelopmentCards() {
  return (
    <section className="home-section home-section--white" id="development-cards" aria-labelledby="dev-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="dev-heading">
            Development cards <span>25 cards, one ore, wool and grain each</span>
          </h2>
        </header>

        <div className="family-grid">
          {cards.map((card, index) => (
            <article
              className={`family-card dev-family dev-family--${card.tone} reveal`}
              key={card.key}
              style={{ '--reveal-delay': `${(index % 4) * 0.06}s` }}
            >
              <div className="family-card-head">
                <span className="family-swatch dev-family-icon" aria-hidden="true">
                  <Icon name={card.icon} size={18} />
                </span>
                <h3>{DEV_CARDS[card.key].label}</h3>
                <span className="family-count">× {card.count}</span>
              </div>
              <p className="dev-family-text">{DEV_CARDS[card.key].text}</p>
              <p className="family-price">{card.detail}</p>
            </article>
          ))}

          {specials.map((card, index) => (
            <article
              className="family-card dev-family dev-family--special reveal"
              key={card.title}
              style={{ '--reveal-delay': `${((index + 1) % 4) * 0.06}s` }}
            >
              <div className="family-card-head">
                <span className="family-swatch dev-family-icon" aria-hidden="true">
                  <Icon name={card.icon} size={18} />
                </span>
                <h3>{card.title}</h3>
                <span className="family-count">+2 VP</span>
              </div>
              <p className="dev-family-text">{card.text}</p>
              <p className="family-price">Special card</p>
            </article>
          ))}
        </div>
        <p className="dev-family-note reveal">
          You may play one development card per turn, before or after rolling, but never one bought this turn. Played
          progress cards leave the game
        </p>
      </div>
    </section>
  );
}

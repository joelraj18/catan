import Carousel from '../../components/Carousel';
import Icon from '../../components/Icon';

const guide = [
  {
    icon: 'brick',
    tone: 'hills',
    title: 'Hills',
    kicker: '3 hexes · produce brick',
    text: 'Brick goes into every road and settlement, so a good hills hex is gold early in the game',
  },
  {
    icon: 'lumber',
    tone: 'forest',
    title: 'Forest',
    kicker: '4 hexes · produce lumber',
    text: 'Lumber pairs with brick for roads and settlements, the backbone of an expanding network',
  },
  {
    icon: 'ore',
    tone: 'mountains',
    title: 'Mountains',
    kicker: '3 hexes · produce ore',
    text: 'Ore builds cities and buys development cards, the key to the late game',
  },
  {
    icon: 'grain',
    tone: 'fields',
    title: 'Fields',
    kicker: '4 hexes · produce grain',
    text: 'Grain is needed for settlements, cities and development cards alike',
  },
  {
    icon: 'wool',
    tone: 'pasture',
    title: 'Pasture',
    kicker: '4 hexes · produce wool',
    text: 'Wool founds settlements and buys development cards, and is often the easiest card to trade away',
  },
  {
    icon: 'desert',
    tone: 'desert',
    title: 'Desert',
    kicker: '1 hex · produces nothing',
    text: 'The desert has no number token. The robber starts the game here',
  },
  {
    icon: 'robber',
    tone: 'robber',
    title: 'The robber',
    kicker: 'Moved on a 7 or by a knight',
    text: 'The hex under the robber produces nothing, and whoever moves it steals a random card from a player next to it',
  },
  {
    icon: 'anchor',
    tone: 'harbor',
    title: 'Harbours',
    kicker: '4 generic 3:1 · 5 special 2:1',
    text: 'A settlement or city on a harbour lets you trade with the bank at a better rate than the usual 4:1',
  },
  {
    icon: 'dice',
    tone: 'numbers',
    title: 'Number tokens',
    kicker: 'Red 6 and 8 roll most often',
    text: 'The dots under each number show how likely it is: five dots for 6 and 8, one dot for 2 and 12. There is no 7',
  },
];

export default function BoardGuide() {
  return (
    <section className="home-section home-section--shelf" id="board-guide" aria-labelledby="guide-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="guide-heading">
            Know the island <span>Every terrain, explained</span>
          </h2>
        </header>
      </div>

      <Carousel label="Terrain and board pieces" className="reveal">
        {guide.map((entry) => (
          <article className={`carousel-item guide-card guide-card--${entry.tone}`} key={entry.title}>
            <span className="guide-card-icon">
              <Icon name={entry.icon} size={30} />
            </span>
            <p className="guide-card-kicker">{entry.kicker}</p>
            <h3>{entry.title}</h3>
            <p className="guide-card-text">{entry.text}</p>
          </article>
        ))}
      </Carousel>
    </section>
  );
}

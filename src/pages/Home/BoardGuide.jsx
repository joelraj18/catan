import Carousel from '../../components/Carousel';
import Icon from '../../components/Icon';
import { routeDetails, utilityDetails } from '../Game/estate';
import { DETENTION_FINE, TAXES } from '../Game/gameEngine';
import { START_REWARD } from '../Game/matchRules';

const rupees = (amount) => `₹${amount.toLocaleString('en-IN')}`;

const guide = [
  {
    icon: 'crown',
    tone: 'sage',
    title: 'Go',
    kicker: 'The starting corner',
    text: `Every journey starts here, pass or land on it to collect ${rupees(START_REWARD)}`,
  },
  {
    icon: 'building',
    tone: 'district',
    title: 'Districts',
    kicker: '22 cities of Andhra Pradesh and Telangana',
    text: 'Buy them as you land, own a full family to start building houses and finally a hotel',
  },
  {
    icon: 'train',
    tone: 'route',
    title: 'Express stations',
    kicker: `Secunderabad, Vijayawada, Kacheguda and Tirupati at ${rupees(routeDetails.price)} each`,
    text: `Rent doubles with every station you hold, from ${rupees(routeDetails.rent[0])} up to ${rupees(
      routeDetails.rent[3],
    )} for all four`,
  },
  {
    icon: 'bolt',
    tone: 'utility',
    title: 'Utilities',
    kicker: 'Power and Water',
    text: `Rent is ${utilityDetails.multipliers[0]} times the dice roll × ${rupees(
      utilityDetails.perPip,
    )}, rising to ${utilityDetails.multipliers[1]} times when one player owns both`,
  },
  {
    icon: 'scroll',
    tone: 'order',
    title: 'Chance',
    kicker: 'Take a chance',
    text: 'Draw a card that may move you across the board, reward you or send you to Jail',
  },
  {
    icon: 'temple',
    tone: 'hundi',
    title: 'Community Chest',
    kicker: 'The town treasury',
    text: 'Mostly blessings and windfalls, with the occasional fee to keep you humble',
  },
  {
    icon: 'fort',
    tone: 'fort',
    title: 'Jail',
    kicker: 'Just visiting, mostly',
    text: `Usually you are just visiting, but three doubles in one turn or the wrong card lock you in until you pay ${rupees(DETENTION_FINE)}, use a pardon or roll doubles`,
  },
  {
    icon: 'rupee',
    tone: 'tax',
    title: 'Taxes',
    kicker: 'Income Tax and Luxury Tax',
    text: `Income Tax collects ${rupees(TAXES[4])} and Luxury Tax ${rupees(TAXES[38])}, both amounts are printed on the board`,
  },
  {
    icon: 'leaf',
    tone: 'rest',
    title: 'Free Parking',
    kicker: 'A rest stop',
    text: 'A calm corner where nothing is owed, catch your breath before the costly streets ahead',
  },
];

export default function BoardGuide() {
  return (
    <section className="home-section home-section--shelf" id="board-guide" aria-labelledby="guide-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="guide-heading">
            Know the board <span>Every space, explained</span>
          </h2>
        </header>
      </div>

      <Carousel label="Board spaces" className="reveal">
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

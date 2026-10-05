import { TOTAL_MATCH_TURNS, START_REWARD } from '../Game/matchRules';
import { BOARD_SPACES, STARTING_BALANCE } from '../Game/boardData';
import FeatureCard from '../../components/FeatureCard';
import Icon from '../../components/Icon';

const toLakh = (amount) => `₹${amount / 100000}L`;

const stats = [
  { value: '2 to 4', label: 'Players at one table' },
  { value: String(BOARD_SPACES.length), label: 'Spaces around the board' },
  { value: String(TOTAL_MATCH_TURNS), label: 'Turns in every match' },
  { value: toLakh(STARTING_BALANCE), label: 'Starting purse for each player' },
  { value: toLakh(START_REWARD), label: 'Collected for passing Go' },
];

const features = [
  {
    icon: <Icon name="crown" size={28} />,
    title: 'Build a legacy',
    description:
      'Acquire storied districts, complete colour families and raise houses and a hotel on the streets you rule',
  },
  {
    icon: <Icon name="users" size={28} />,
    title: 'Read the table',
    description:
      'Every roll changes the board, so time your purchases, guard your cash and turn each decision into prestige',
  },
  {
    icon: <Icon name="globe" size={28} />,
    title: 'Play anywhere',
    description:
      'No downloads and no sign up, open a private room in your browser on a laptop, tablet or phone',
  },
];

export default function Highlights() {
  return (
    <section className="home-section" id="overview" aria-labelledby="overview-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="overview-heading">
            Get to know Manapally <span>A royal table, set for strategy</span>
          </h2>
        </header>

        <dl className="stat-strip reveal">
          {stats.map((stat) => (
            <div className="stat" key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>

        <div className="feature-grid">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} {...feature} delay={index * 0.08} />
          ))}
        </div>
      </div>
    </section>
  );
}

import { NUMBER_BAG, RESOURCES } from '../Game/catanBoard';
import { BANK_SIZE, WINNING_POINTS } from '../Game/catanRules';
import FeatureCard from '../../components/FeatureCard';
import Icon from '../../components/Icon';

const stats = [
  { value: '3 to 4', label: 'Players at one table' },
  { value: '19', label: 'Terrain hexes on the island' },
  { value: String(NUMBER_BAG.length), label: 'Number tokens, 2 to 12' },
  { value: String(RESOURCES.length * BANK_SIZE), label: 'Resource cards in the bank' },
  { value: String(WINNING_POINTS), label: 'Victory points to win' },
];

const features = [
  {
    icon: <Icon name="hex" size={28} />,
    title: 'Settle the island',
    description:
      'Found settlements where the terrain is rich, connect them with roads and upgrade them into cities that produce twice as much',
  },
  {
    icon: <Icon name="trade" size={28} />,
    title: 'Trade to win',
    description:
      'Nobody makes everything they need, so bargain with the table or ship your surplus through a harbour at a better rate',
  },
  {
    icon: <Icon name="globe" size={28} />,
    title: 'Play anywhere',
    description: 'No downloads and no sign up, open a private room in your browser on a laptop, tablet or phone',
  },
];

export default function Highlights() {
  return (
    <section className="home-section" id="overview" aria-labelledby="overview-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="overview-heading">
            Get to know Catan <span>An island, set for strategy</span>
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

import Icon from '../../components/Icon';
import { TOTAL_MATCH_TURNS } from '../Game/matchRules';

const tips = [
  {
    icon: 'train',
    title: 'Collect the express stations',
    text: 'Each extra station doubles the rent, and all four together earn ₹2,00,000 from every visitor',
  },
  {
    icon: 'layers',
    title: 'Finish a colour family',
    text: 'Houses and hotels can only be built once you own every district in that family',
  },
  {
    icon: 'home',
    title: 'Build evenly',
    text: 'Houses rise one at a time across a family, so spread them out to unlock the next level',
  },
  {
    icon: 'coins',
    title: 'Keep a cash cushion',
    text: 'Rent can arrive on any roll, a healthy reserve saves you from selling under pressure',
  },
  {
    icon: 'rupee',
    title: 'Mortgage before you sell',
    text: 'A mortgage returns cash quickly and can be lifted later for its value plus 10 percent',
  },
  {
    icon: 'chart',
    title: 'Watch the turn counter',
    text: `The highest net worth after turn ${TOTAL_MATCH_TURNS} wins, so property counts as much as cash in the final stretch`,
  },
];

export default function Tips() {
  return (
    <section className="home-section" id="tips" aria-labelledby="tips-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="tips-heading">
            Tips from the table <span>Small moves that win matches</span>
          </h2>
        </header>

        <div className="tip-grid">
          {tips.map((tip, index) => (
            <article className="tip-card reveal" key={tip.title} style={{ '--reveal-delay': `${(index % 3) * 0.08}s` }}>
              <span className="tip-icon">
                <Icon name={tip.icon} size={24} />
              </span>
              <div>
                <h3>{tip.title}</h3>
                <p>{tip.text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

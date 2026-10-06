import Icon from '../../components/Icon';

const tips = [
  {
    icon: 'brick',
    title: 'Brick and lumber first',
    text: 'You need both for every road and settlement, so put at least one starting settlement on a good forest or hills hex',
  },
  {
    icon: 'dice',
    title: 'Count the dots',
    text: 'The dots under a number show how often it rolls. A settlement touching 6, 8 and 5 out-earns one on 2, 12 and 11 many times over',
  },
  {
    icon: 'anchor',
    title: 'Do not underestimate harbours',
    text: 'If your settlements make a lot of one resource, a 2:1 harbour for it turns surplus into whatever you lack',
  },
  {
    icon: 'hex',
    title: 'Leave room to grow',
    text: 'Look at your opponents’ roads before placing. The middle of the island is rich but easy to get boxed in',
  },
  {
    icon: 'city',
    title: 'Cities win games',
    text: 'With only 5 settlements you can reach 5 points by building them alone. Cities double production and points',
  },
  {
    icon: 'trade',
    title: 'Trade often',
    text: 'The more you trade, the better your chances. Offer deals to the player whose turn it is even when it is not yours',
  },
];

export default function Tips() {
  return (
    <section className="home-section" id="tips" aria-labelledby="tips-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="tips-heading">
            Tips from the table <span>Small moves that win games</span>
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

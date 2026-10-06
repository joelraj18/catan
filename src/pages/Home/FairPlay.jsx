import Icon from '../../components/Icon';
import { WINNING_POINTS } from '../Game/catanRules';

const pillars = [
  {
    icon: 'shield',
    title: 'Secure dice',
    text: 'Every roll uses the cryptographic random generator built into your browser, with rejection sampling so all six faces are exactly as likely',
  },
  {
    icon: 'dice',
    title: 'Real two dice odds',
    text: 'Two separate dice give the rulebook odds: 7 comes up 17% of the time, 6 and 8 14% each, 2 and 12 only 3%',
  },
  {
    icon: 'card',
    title: 'Hidden cards stay hidden',
    text: `Each player only receives their own hand and development cards. Victory point cards are revealed when someone reaches ${WINNING_POINTS} points`,
  },
];

export default function FairPlay() {
  return (
    <section className="home-section home-section--dark" id="fair-play" aria-labelledby="fair-heading">
      <div className="section-inner">
        <header className="section-head section-head--center reveal">
          <p className="eyebrow">Fair play</p>
          <h2 id="fair-heading" className="gradient-text">
            Fair by design
          </h2>
          <p className="section-lede section-lede--single">
            No hidden tricks and no weighted luck, only your decisions and an honest roll
          </p>
        </header>

        <div className="pillar-grid">
          {pillars.map((pillar, index) => (
            <article className="pillar reveal" key={pillar.title} style={{ '--reveal-delay': `${index * 0.1}s` }}>
              <Icon name={pillar.icon} size={34} strokeWidth={1.5} />
              <h3>{pillar.title}</h3>
              <p>{pillar.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

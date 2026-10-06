const steps = [
  {
    title: 'Set up the island',
    text: 'Open a private room, pick a colour and choose the beginners’ map from the rulebook or a random island. Each player starts with 2 settlements and 2 roads',
  },
  {
    title: 'Roll for resources',
    text: 'Every turn starts with the dice. Each hex showing the number pays 1 card to every settlement and 2 to every city next to it. Roll a 7 and the robber strikes instead',
  },
  {
    title: 'Trade',
    text: 'Swap cards with the player whose turn it is, or trade with the bank at 4:1, 3:1 or 2:1 when you own a harbour',
  },
  {
    title: 'Build and win',
    text: 'Spend cards on roads, settlements, cities and development cards. The first player to reach 10 victory points on their turn wins',
  },
];

export default function HowToPlay({ onPlay }) {
  return (
    <section className="home-section home-section--white" id="how-to-play" aria-labelledby="how-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="how-heading">
            How to play <span>Four steps to your first win</span>
          </h2>
        </header>

        <ol className="steps">
          {steps.map((step, index) => (
            <li className="step reveal" key={step.title} style={{ '--reveal-delay': `${index * 0.08}s` }}>
              <span className="step-number">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>

        <div className="steps-cta reveal">
          <button type="button" className="text-link text-link--large" onClick={onPlay}>
            Try it now in a private room <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </section>
  );
}

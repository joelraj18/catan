const steps = [
  {
    title: 'Choose a name and a piece',
    text: 'Enter a display name in the lobby and pick one of twelve pieces, from the Deepam and the Tiger to the Cricket Bat and the Crown, each with its own seat colour',
  },
  {
    title: 'Open a private room',
    text: 'Create a room to receive a six character invitation code, then choose a table of 2, 3 or 4 seats',
  },
  {
    title: 'Roll and move',
    text: 'Press Roll the dice and your token walks clockwise, every space you land on has something to say',
  },
  {
    title: 'Buy, trade and build',
    text: 'Buy open districts, trade with other players to complete a colour family, then build houses and a hotel and collect rent from every visitor',
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

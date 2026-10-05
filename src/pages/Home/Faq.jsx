import { useState } from 'react';

const questions = [
  {
    q: 'Do I need an account to play?',
    a: 'No account is needed, enter a display name in the lobby and you are ready to start',
  },
  {
    q: 'How many players can play?',
    a: 'Catan is played by 3 or 4 players. Fill any open seat with a computer opponent, or a premium AI opponent if you have a Claude API key',
  },
  {
    q: 'Can friends join my room?',
    a: 'Yes, share your invite link or six character room code and friends anywhere join from the lobby, then chat with the table while you play',
  },
  {
    q: 'My friend cannot join, what can we try?',
    a: 'Send the invite link from the waiting room so the code is filled in for them, and keep the Catan tab open on the host screen because phones pause tabs in the background, joining uses Auto by default, which connects directly and switches to Relay on college, office or VPN networks that block direct links, if it still fails open Having trouble joining in the lobby and run Check connection, then try mobile data or a hotspot',
  },
  {
    q: 'Which board should I pick?',
    a: 'The beginners\u2019 board is the balanced map from the rulebook with every starting settlement and road already placed. The random board shuffles terrain, numbers and harbours, never puts two red numbers side by side, and starts with each player placing two settlements and roads in turn',
  },
  {
    q: 'How much time do I get on my turn?',
    a: 'As long as you like before you roll, then up to four minutes to trade and build. Placing set-up pieces, discarding and moving the robber have their own countdowns, and when one runs out the computer makes that move for you so the table never stalls',
  },
  {
    q: 'What if I lose my connection or close the tab?',
    a: 'Your seat is kept, the computer plays it for you until you return, open Catan, choose Rejoin in the lobby and enter the room code with the Player ID shown in the game',
  },
  {
    q: 'How does trading work?',
    a: 'On your turn you can offer cards to everyone or to one player, and trade with the bank at 4:1, or 3:1 and 2:1 with a harbour. On someone else\u2019s turn you can make offers to that player only. Gifts and trading a resource for the same resource are not allowed',
  },
  {
    q: 'How is the winner decided?',
    a: 'The first player to have 10 or more victory points during their own turn wins at once. Points come from settlements, cities, the Longest Road, the Largest Army and victory point cards',
  },
  {
    q: 'Can I play on my phone?',
    a: 'Yes, the layout adapts to any screen and the island scales to fit, tap a highlighted spot to build',
  },
  {
    q: 'How do I turn the music on or off?',
    a: 'Tap the speaker button at the top of the home page or the game to open the sound panel, music and sound effects each have their own switch and volume slider',
  },
];

export default function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section className="home-section home-section--white" id="faq" aria-labelledby="faq-heading">
      <div className="section-inner section-inner--narrow">
        <header className="section-head reveal">
          <h2 id="faq-heading">
            Questions <span>Answers</span>
          </h2>
        </header>

        <div className="faq-list reveal">
          {questions.map((item, index) => {
            const isOpen = open === index;
            const panelId = `faq-panel-${index}`;

            return (
              <div className={`faq-item ${isOpen ? 'faq-item--open' : ''}`} key={item.q}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? -1 : index)}
                  >
                    <span>{item.q}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="faq-toggle">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </h3>

                <div className="faq-panel" id={panelId} role="region">
                  <div>
                    <p>{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

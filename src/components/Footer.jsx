import { BrandMark } from './BrandLogo';

// Apple style footer: numbered footnotes, a breadcrumb, a directory of
// working links and a legal row. Every link performs a real action.
export default function Footer({ onNavigate, onPlay, onMusicToggle, musicEnabled }) {
  const directory = [
    {
      title: 'Play',
      links: [
        { label: 'Start game', action: onPlay },
        { label: 'Choose a piece', action: () => onNavigate('pieces') },
        { label: musicEnabled ? 'Turn music off' : 'Turn music on', action: onMusicToggle },
      ],
    },
    {
      title: 'Learn',
      links: [
        { label: 'How to play', action: () => onNavigate('how-to-play') },
        { label: 'Board guide', action: () => onNavigate('board-guide') },
        { label: 'District families', action: () => onNavigate('districts') },
      ],
    },
    {
      title: 'Strategy',
      links: [
        { label: 'Tips from the table', action: () => onNavigate('tips') },
        { label: 'Fair dice', action: () => onNavigate('fair-play') },
        { label: 'Questions and answers', action: () => onNavigate('faq') },
      ],
    },
  ];

  return (
    <footer className="footer">
      <div className="footer-inner">
        <ol className="footer-notes">
          <li>
            Matches run for a fixed 248 completed turns shared by every seat, so a two
            player table gives each player 124 turns and a four player table gives each
            player 62
          </li>
          <li>
            The winner is the player with the highest total net worth, cash plus the value
            of every property held, when the turns run out or everyone else is bankrupt
          </li>
          <li>
            Friends join by room code over a direct browser to browser connection, premium AI
            opponents use your own Claude API key, which stays in your browser's memory
          </li>
        </ol>

        <div className="footer-breadcrumb">
          <button type="button" onClick={() => onNavigate('top')} aria-label="Back to top">
            <BrandMark size={16} />
          </button>
          <span aria-hidden="true">›</span>
          <span>Home</span>
        </div>

        <nav className="footer-directory" aria-label="Footer">
          {directory.map((column) => (
            <div className="footer-column" key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <button type="button" onClick={link.action}>
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="footer-legal">
          <p className="footer-legal-copy">
            <span>Copyright © {new Date().getFullYear()} Manapally</span>
            <span>All rights reserved</span>
          </p>
          <p className="footer-legal-region">India</p>
        </div>
      </div>
    </footer>
  );
}

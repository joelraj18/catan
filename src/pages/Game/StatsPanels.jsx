import { expectedShare } from './gameStats';
import { PieceMark } from './pieces.jsx';

// How the dice have fallen so far: a bar for every total from 2 to 12,
// with a tick where it would sit if the dice rolled exactly to the odds.
export function DiceChart({ stats, highlight = null }) {
  const rolls = stats?.rolls || Array(13).fill(0);
  const count = rolls.reduce((sum, n) => sum + n, 0);
  const totals = Array.from({ length: 11 }, (_, i) => i + 2);
  const top = Math.max(1, ...totals.map((total) => Math.max(rolls[total], expectedShare(total) * count)));
  return (
    <section className="dice-chart" aria-label={`Dice rolled ${count} times`}>
      <div className="dice-chart-head">
        <p className="eyebrow">Dice so far</p>
        <span>{count} roll{count === 1 ? '' : 's'}</span>
      </div>
      <ol className="dice-chart-bars">
        {totals.map((total) => (
          <li
            key={total}
            className={`${total === 6 || total === 8 ? 'dice-chart-hot' : ''} ${highlight === total ? 'dice-chart-now' : ''}`}
            title={`${total}: rolled ${rolls[total]} time${rolls[total] === 1 ? '' : 's'}, about ${(expectedShare(total) * count).toFixed(1)} expected`}
          >
            <span className="dice-chart-bar" style={{ height: `${(rolls[total] / top) * 100}%` }}>
              {rolls[total] > 0 && <em>{rolls[total]}</em>}
            </span>
            <span className="dice-chart-expected" style={{ bottom: `${((expectedShare(total) * count) / top) * 100}%` }} />
            <strong>{total}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

// After the game: what each player collected, stole and lost along the way.
export function GameStatsTable({ stats, players }) {
  if (!stats) return null;
  const rows = [
    ['Cards collected', stats.gained],
    ['Cards stolen', stats.stole],
    ['Robbed', stats.robbed],
    ['Lost to 7s', stats.discarded],
    ['Dev cards played', stats.devPlayed],
  ];
  const best = (table) => Math.max(0, ...players.map((player) => table?.[player.id] || 0));
  return (
    <div className="game-stats">
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Statistic</span>
            </th>
            {players.map((player) => (
              <th key={player.id} scope="col" className={`seat-${player.pieceKey}`} title={player.name}>
                <PieceMark piece={player.pieceKey} variant="token" title={player.name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, table]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {players.map((player) => {
                const value = table?.[player.id] || 0;
                return (
                  <td key={player.id} className={value && value === best(table) ? 'game-stats-top' : ''}>
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

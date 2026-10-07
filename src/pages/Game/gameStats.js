// Running numbers for the whole game, all from public events: how often
// each total was rolled, and per player the cards they collected, stole,
// lost to thieves and to 7s, and the development cards they played. They
// feed the dice chart beside the board and the stats after the game.

export const emptyStats = () => ({ rolls: Array(13).fill(0), gained: {}, stole: {}, robbed: {}, discarded: {}, devPlayed: {} });

const sizeOf = (bundle) => Object.values(bundle || {}).reduce((sum, count) => sum + (count || 0), 0);
const add = (table, id, amount) => (id && amount ? { ...table, [id]: (table[id] || 0) + amount } : table);

export const tallyEvent = (stats, event) => {
  const next = stats || emptyStats();
  switch (event.type) {
    case 'roll': {
      const total = (event.dice?.[0] || 0) + (event.dice?.[1] || 0);
      if (total < 2 || total > 12) return next;
      const rolls = [...next.rolls];
      rolls[total] += 1;
      return { ...next, rolls };
    }
    case 'produce':
      return {
        ...next,
        gained: Object.entries(event.gains || {}).reduce((table, [id, bundle]) => add(table, id, sizeOf(bundle)), next.gained),
      };
    case 'steal':
      return { ...next, stole: add(next.stole, event.actor, 1), robbed: add(next.robbed, event.victim, 1) };
    case 'discard':
      return { ...next, discarded: add(next.discarded, event.actor, event.count || sizeOf(event.bundle)) };
    case 'playDev':
      return { ...next, devPlayed: add(next.devPlayed, event.actor, 1) };
    case 'monopoly':
      return { ...next, gained: add(next.gained, event.actor, event.total || 0) };
    case 'yop':
      return { ...next, gained: add(next.gained, event.actor, sizeOf(event.bundle)) };
    default:
      return next;
  }
};

// The share of rolls each total should get with two dice.
export const expectedShare = (total) => (6 - Math.abs(7 - total)) / 36;

export const rollOdds = (total) => {
  const ways = 6 - Math.abs(7 - total);
  return `${ways}/36, ${((ways / 36) * 100).toFixed(1)}%`;
};

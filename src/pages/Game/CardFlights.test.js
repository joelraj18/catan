import { flightsFor } from './CardFlights';
import { beginnerBoard } from './catanBoard';

const board = beginnerBoard();

describe('cards in flight', () => {
  test('a steal flies from the victim to the thief, face down for everyone else', () => {
    const steal = { type: 'steal', actor: 'p1', victim: 'p2', resource: null };
    expect(flightsFor(steal, 'p3', board)).toEqual([{ from: 'seat-p2', to: 'seat-p1', card: 'back', shake: 'seat-p2' }]);
    // The thief sees the card land in their own hand.
    expect(flightsFor({ ...steal, resource: 'ore' }, 'p1', board)[0]).toMatchObject({ from: 'seat-p2', to: 'hand-ore', card: 'ore' });
  });

  test('Monopoly takes from every victim, and trades cross both ways', () => {
    const monopoly = { type: 'monopoly', actor: 'p1', resource: 'wool', from: { p2: 2, p3: 1 }, total: 3 };
    const trips = flightsFor(monopoly, 'p2', board);
    expect(trips.filter((trip) => trip.from === 'hand-wool')).toHaveLength(2);
    expect(trips.filter((trip) => trip.from === 'seat-p3')).toHaveLength(1);
    expect(trips.every((trip) => trip.to === 'seat-p1')).toBe(true);

    const trade = { type: 'trade', actor: 'p1', partner: 'p2', give: { brick: 1 }, get: { ore: 2 } };
    expect(flightsFor(trade, 'p1', board)).toEqual([
      { from: 'hand-brick', to: 'seat-p2', card: 'brick' },
      { from: 'seat-p2', to: 'hand-ore', card: 'ore' },
      { from: 'seat-p2', to: 'hand-ore', card: 'ore' },
    ]);
  });

  test('production flies from the tile of that resource; bank trades go through the bank', () => {
    const hill = board.hexes.find((hex) => hex.terrain === 'hills');
    const produce = { type: 'produce', gains: { p1: { brick: 1 } }, hexes: [hill.id] };
    expect(flightsFor(produce, 'p1', board)).toEqual([
      { from: `hex-${hill.id}`, to: 'hand-brick', card: 'brick', rise: true, gain: { seat: 'seat-p1', total: 1 } },
    ]);

    const maritime = { type: 'maritime', actor: 'p2', give: { grain: 4 }, get: { ore: 1 } };
    const trips = flightsFor(maritime, 'p1', board);
    expect(trips.filter((trip) => trip.to === 'bank')).toHaveLength(4);
    expect(trips.at(-1)).toEqual({ from: 'bank', to: 'seat-p2', card: 'ore' });
  });
});

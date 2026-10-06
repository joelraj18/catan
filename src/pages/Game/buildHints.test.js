import { affordableBuilds, firstMissing, listBuilds } from './buildHints';
import { beginnerPieces, createInitialState } from './catanEngine';

const players = ['p1', 'p2', 'p3'].map((id, i) => ({ id, name: id, pieceKey: ['red', 'blue', 'white'][i], kind: 'human' }));
const fresh = () => {
  const state = createInitialState(players, { board: 'beginner', pickIndex: () => 0 });
  return { ...state, ...beginnerPieces(state.players, state.board) };
};
const withHand = (state, hand) => ({ ...state, hands: { ...state.hands, p1: { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0, ...hand } } });

describe('what you can build', () => {
  test('follows the hand, the pieces and the board', () => {
    const state = fresh();
    expect(affordableBuilds(withHand(state, {}), 'p1')).toEqual([]);
    expect(affordableBuilds(withHand(state, { brick: 1, lumber: 1 }), 'p1')).toEqual(['road']);
    expect(affordableBuilds(withHand(state, { ore: 3, grain: 2, wool: 1 }), 'p1')).toEqual(['city', 'dev']);
    expect(affordableBuilds(withHand({ ...state, devDeck: [] }, { ore: 1, grain: 1, wool: 1 }), 'p1')).toEqual([]);
    // Someone else's hidden hand says nothing.
    expect(affordableBuilds({ ...state, hands: { p1: { hidden: 9 } } }, 'p1')).toEqual([]);
  });

  test('reads naturally', () => {
    expect(listBuilds(['city'])).toBe('a City');
    expect(listBuilds(['road', 'settlement'])).toBe('a Road and a Settlement');
    expect(listBuilds(['road', 'city', 'dev'])).toBe('a Road, a City and a Development card');
    expect(firstMissing({ ore: 1, wool: 0 }, { ore: 1, wool: 1, grain: 1 })).toBe('wool');
    expect(firstMissing({ ore: 1, wool: 1, grain: 1 }, { ore: 1, wool: 1, grain: 1 })).toBeNull();
  });
});

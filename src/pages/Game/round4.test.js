import { anchorFor, curveFrames, visibleCentre } from './CardFlights';
import { dragonPath } from './hexArt.jsx';
import { motionLevel, scaled, setMotion } from '../../services/motion';
import { outdatedSeats } from '../../services/build';
import { listMissing } from './buildHints';

const box = (left, top, width = 40, height = 40) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) });
const transformXY = (frame) => frame.transform.match(/-?[\d.]+px/g).map((value) => parseFloat(value));

describe('motion follows the game, not the computer', () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    window.localStorage.clear();
  });

  test('animations play in full by default, even when the system asks for reduced motion', () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    expect(motionLevel()).toBe('full');
    expect(scaled(1000)).toBe(1000);
  });

  test('Gentle shortens and Off stops them, and the choice is kept', () => {
    setMotion('gentle');
    expect(scaled(1000)).toBe(600);
    setMotion('off');
    expect(scaled(1000)).toBe(0);
    expect(window.localStorage.getItem('catan-motion')).toBe('off');
    setMotion('sideways');
    expect(motionLevel()).toBe('off');
  });
});

describe('cards that are always seen', () => {
  test('an off-screen target is pulled inside the window', () => {
    const view = { width: 1000, height: 700 };
    expect(visibleCentre(box(100, 100), view)).toEqual({ x: 120, y: 120 });
    expect(visibleCentre(box(400, 1600), view)).toEqual({ x: 420, y: 676 });
    expect(visibleCentre(box(-300, 200), view)).toEqual({ x: 24, y: 220 });
    expect(visibleCentre(box(0, 0, 0, 0), view)).toBeNull();
  });

  test("another player's cards land on their card count, then their seat, then the bank", () => {
    const shown = { 'cards-p2': box(10, 10), 'seat-p3': box(50, 50), bank: box(90, 90) };
    const find = (name) => shown[name] || null;
    expect(anchorFor('seat-p2', 'ore', find)).toBe(shown['cards-p2']);
    expect(anchorFor('seat-p3', 'ore', find)).toBe(shown['seat-p3']);
    expect(anchorFor('seat-p2', 'dev', find)).toBe(shown.bank);
    expect(anchorFor('hand-ore', 'ore', find)).toBe(shown.bank);
  });

  test('a flight is a smooth curve: no jumps between frames, fading in and out', () => {
    const frames = curveFrames({ dx: 600, dy: 300, lift: 80 });
    expect(frames[0].offset).toBe(0);
    expect(frames.at(-1).offset).toBe(1);
    expect(frames[0].opacity).toBe(0);
    expect(frames.at(-1).opacity).toBe(0);
    const points = frames.map(transformXY);
    expect(points.at(-1)).toEqual([600, 300]);
    for (let i = 1; i < points.length; i += 1) {
      const step = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      expect(step).toBeLessThan(Math.hypot(600, 300) * 0.22);
    }
    // It arcs above the straight line between the two places.
    expect(Math.min(...points.map(([, y]) => y))).toBeLessThan(0);
  });
});

describe('the dragon flies', () => {
  test('from one tile to the next along a wide arc, landing upright', () => {
    const frames = dragonPath({ x: 0, y: 0 }, { x: 60, y: 0 });
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.at(-1).transform).toBe('translate(60px, 0px) scale(1)');
    // Even a short hop climbs well clear of the board.
    const ys = frames.map((frame) => transformXY(frame)[1]);
    expect(Math.min(...ys)).toBeLessThan(-50);
    frames.slice(1).forEach((frame, index) => expect(frame.offset).toBeGreaterThan(frames[index].offset));
  });
});

describe('one version at the table', () => {
  test('seats on a different build from the host are named', () => {
    const lobby = { build: 'abc', seats: [{ name: 'Joel', build: 'abc' }, { name: 'Sam', build: 'old' }, { name: 'Bot' }] };
    expect(outdatedSeats(lobby).map((seat) => seat.name)).toEqual(['Sam']);
    expect(outdatedSeats({ seats: lobby.seats })).toEqual([]);
  });
});

test('what a build is still missing reads naturally', () => {
  expect(listMissing({ brick: 1 }, { brick: 1, lumber: 1 })).toBe('1 lumber');
  expect(listMissing({}, { ore: 3, grain: 2 })).toBe('3 ore and 2 grain');
  expect(listMissing({ ore: 3, grain: 2 }, { ore: 3, grain: 2 })).toBe('');
});

describe('the game keeps score of the dice and the cards', () => {
  // eslint-disable-next-line global-require
  const { emptyStats, tallyEvent, rollOdds } = require('./gameStats');

  test('rolls, harvests, thefts, discards and cards played are counted', () => {
    let stats = emptyStats();
    [
      { type: 'roll', dice: [3, 5] },
      { type: 'roll', dice: [4, 4] },
      { type: 'roll', dice: [6, 1] },
      { type: 'produce', gains: { p1: { ore: 2, wool: 1 }, p2: { grain: 1 } } },
      { type: 'steal', actor: 'p2', victim: 'p1', resource: null },
      { type: 'discard', actor: 'p1', count: 4 },
      { type: 'playDev', actor: 'p2', card: 'knight' },
      { type: 'monopoly', actor: 'p2', resource: 'ore', total: 3 },
      { type: 'emote', actor: 'p1', key: 'sheep' },
    ].forEach((event) => {
      stats = tallyEvent(stats, event);
    });
    expect(stats.rolls[8]).toBe(2);
    expect(stats.rolls[7]).toBe(1);
    expect(stats.gained).toEqual({ p1: 3, p2: 4 });
    expect(stats.stole).toEqual({ p2: 1 });
    expect(stats.robbed).toEqual({ p1: 1 });
    expect(stats.discarded).toEqual({ p1: 4 });
    expect(stats.devPlayed).toEqual({ p2: 1 });
    expect(rollOdds(8)).toBe('5/36, 13.9%');
  });
});

import {
  clearPremiumKey,
  hasPremiumKey,
  premiumAdvisor,
  setPremiumKey,
  verifyPremiumKey,
} from './premiumAi';
import GameEngine from '../pages/Game/catanEngine';

const headersOf = (init) => {
  const map = {};
  const source = init.headers;
  if (source && typeof source.forEach === 'function') {
    source.forEach((value, key) => { map[key.toLowerCase()] = value; });
  } else {
    Object.entries(source || {}).forEach(([key, value]) => { map[key.toLowerCase()] = value; });
  }
  return map;
};

const fakeResponse = (status, body) => {
  const headers = { 'content-type': 'application/json', 'request-id': 'req_test' };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    url: '',
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
      has: (name) => name.toLowerCase() in headers,
      forEach: (fn) => Object.entries(headers).forEach(([k, v]) => fn(v, k)),
      entries: () => Object.entries(headers)[Symbol.iterator](),
      [Symbol.iterator]: () => Object.entries(headers)[Symbol.iterator](),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
  };
};

const message = (text, stopReason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

const players = [
  { id: 'p1', name: 'Joel', pieceKey: 'red', kind: 'human' },
  { id: 'p2', name: 'AI Opponent 1', pieceKey: 'blue', kind: 'ai' },
  { id: 'p3', name: 'Computer 1', pieceKey: 'white', kind: 'bot' },
];

// A beginners' table with cards in every hand.
const table = () => {
  const engine = new GameEngine({
    players,
    options: { board: 'beginner' },
    rollDie: () => 3,
    pickIndex: () => 0,
  });
  const { state } = engine;
  engine.destroy();
  return state;
};

const OPTIONS = ['Intersection 12: fields 6 + hills 8', 'Intersection 30: forest 5 + pasture 9'];

describe('premium AI', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    clearPremiumKey();
  });

  const mockFetch = (responder) => {
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url: String(url), headers: headersOf(init), body: init.body ? JSON.parse(init.body) : null });
      return responder(String(url));
    });
  };

  test('does nothing without a key', async () => {
    mockFetch(() => fakeResponse(200, message('{}')));
    const answer = await premiumAdvisor({ kind: 'setup', playerId: 'p2', state: table(), options: OPTIONS });
    expect(answer).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a decision sends the right request and parses the reply', async () => {
    mockFetch(() => fakeResponse(200, message('{"choice":1,"comment":"Forest and sheep, lovely."}')));
    setPremiumKey('sk-ant-test-key');

    const state = table();
    const answer = await premiumAdvisor({ kind: 'setup', playerId: 'p2', state, options: OPTIONS });

    expect(answer).toEqual({ choice: 1, comment: 'Forest and sheep, lovely' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toContain('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('sk-ant-test-key');
    expect(call.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(call.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(call.body.model).toBe('claude-opus-5-5');
    expect(call.body.fallbacks).toBe('default');
    expect(call.body.output_config.effort).toBe('low');
    expect(call.body.output_config.format.type).toBe('json_schema');
    expect(call.body.output_config.format.schema.required).toEqual(['choice', 'comment']);
    expect(call.body.messages[0].content).toContain('forest 5 + pasture 9');
    // The key never travels inside the prompt
    expect(JSON.stringify(call.body)).not.toContain('sk-ant-test-key');
  });

  test('the prompt shows only the AI seat\'s own cards', async () => {
    mockFetch(() => fakeResponse(200, message('{"choice":0,"comment":"Hmm"}')));
    setPremiumKey('sk-ant-test-key');
    const state = table();
    await premiumAdvisor({ kind: 'robber', playerId: 'p2', state, options: OPTIONS });
    const context = JSON.parse(calls[0].body.messages[0].content.split('\n\n').slice(1).join('\n\n'));
    expect(context.you.hand).toEqual(state.hands.p2);
    expect(context.opponents.every((opponent) => typeof opponent.cards === 'number' && !opponent.hand)).toBe(true);
  });

  test('an out of range choice becomes the first option', async () => {
    mockFetch(() => fakeResponse(200, message('{"choice":7,"comment":"Bold"}')));
    setPremiumKey('sk-ant-test-key');
    const answer = await premiumAdvisor({ kind: 'turn', playerId: 'p2', state: table(), options: OPTIONS });
    expect(answer.choice).toBe(0);
  });

  test('a refusal falls back to the built in strategy', async () => {
    mockFetch(() => fakeResponse(200, message('', 'refusal')));
    setPremiumKey('sk-ant-test-key');
    const answer = await premiumAdvisor({ kind: 'trade', playerId: 'p2', state: table(), options: OPTIONS });
    expect(answer).toBeNull();
  });

  test('key verification reports valid, invalid and unreachable', async () => {
    setPremiumKey('sk-ant-test-key');
    mockFetch(() => fakeResponse(200, { data: [], has_more: false, first_id: null, last_id: null }));
    expect(await verifyPremiumKey()).toBe('valid');
    expect(calls[0].url).toContain('/v1/models');

    setPremiumKey('sk-ant-wrong');
    mockFetch(() => fakeResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    expect(await verifyPremiumKey()).toBe('invalid');

    setPremiumKey('sk-ant-test-key');
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await verifyPremiumKey()).toBe('unreachable');
  }, 20000);

  test('the key is kept in memory only', () => {
    setPremiumKey('sk-ant-memory-only');
    expect(hasPremiumKey()).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain('sk-ant');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('sk-ant');
    expect(document.cookie).not.toContain('sk-ant');
    clearPremiumKey();
    expect(hasPremiumKey()).toBe(false);
  });
});

import {
  cleanPlan,
  clearPremiumKey,
  hasPremiumKey,
  premiumAdvisor,
  premiumUsage,
  resetPremiumUsage,
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

  test('a decision sends a small request with a cached prefix and parses the plan', async () => {
    mockFetch(() => fakeResponse(200, message('{"plan":[1],"comment":"Forest and sheep, lovely."}')));
    setPremiumKey('sk-ant-test-key');

    const state = table();
    const answer = await premiumAdvisor({ kind: 'setup', playerId: 'p2', state, options: OPTIONS });

    expect(answer).toMatchObject({ plan: [1], choice: 1, comment: 'Forest and sheep, lovely' });
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
    expect(call.body.output_config.format.schema.required).toEqual(['plan', 'comment']);
    // Rules and board are a stable, cached prefix; only the table state varies.
    expect(call.body.system).toHaveLength(2);
    expect(call.body.system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.body.system[1].text).toContain('H9 desert');
    expect(call.body.messages[0].content).toContain('1. Intersection 30: forest 5 + pasture 9');
    // The key never travels inside the prompt
    expect(JSON.stringify(call.body)).not.toContain('sk-ant-test-key');
  });

  test('the prefix is identical across decisions so the cache is reused', async () => {
    mockFetch(() => fakeResponse(200, message('{"plan":[0],"comment":"Hmm"}')));
    setPremiumKey('sk-ant-test-key');
    const state = table();
    await premiumAdvisor({ kind: 'setup', playerId: 'p2', state, options: OPTIONS });
    await premiumAdvisor({ kind: 'turn', playerId: 'p2', state, options: OPTIONS });
    expect(calls[0].body.system).toEqual(calls[1].body.system);
    expect(calls[0].body.output_config).toEqual(calls[1].body.output_config);
  });

  test('the prompt shows only the AI seat\'s own cards', async () => {
    mockFetch(() => fakeResponse(200, message('{"plan":[0],"comment":"Hmm"}')));
    setPremiumKey('sk-ant-test-key');
    const state = table();
    state.hands = { ...state.hands, p1: { brick: 7, lumber: 0, ore: 0, grain: 0, wool: 0 } };
    await premiumAdvisor({ kind: 'robber', playerId: 'p2', state, options: OPTIONS });
    const prompt = calls[0].body.messages[0].content;
    const mine = state.hands.p2;
    expect(prompt).toContain(`hand B${mine.brick} L${mine.lumber} O${mine.ore} G${mine.grain} W${mine.wool}`);
    expect(prompt).toContain('Joel: 2 points | 7 cards');
    expect(prompt).not.toContain('B7');
  });

  test('plans keep valid distinct options in order', async () => {
    expect(cleanPlan([2, 2, 9, -1, 'x', 0, 1], 3)).toEqual([2, 0, 1]);
    expect(cleanPlan(null, 3)).toEqual([]);
    mockFetch(() => fakeResponse(200, message('{"plan":[7],"comment":"Bold"}')));
    setPremiumKey('sk-ant-test-key');
    const answer = await premiumAdvisor({ kind: 'turn', playerId: 'p2', state: table(), options: OPTIONS });
    expect(answer.plan).toEqual([]);
    expect(answer.choice).toBe(0);
  });

  test('token use is counted per AI seat', async () => {
    resetPremiumUsage();
    mockFetch(() => fakeResponse(200, { ...message('{"plan":[0],"comment":"Hi"}'), usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 700 } }));
    setPremiumKey('sk-ant-test-key');
    const state = table();
    await premiumAdvisor({ kind: 'turn', playerId: 'p2', state, options: OPTIONS });
    const answer = await premiumAdvisor({ kind: 'turn', playerId: 'p2', state, options: OPTIONS });
    expect(premiumUsage('p2')).toEqual({ calls: 2, input: 240, output: 60, cached: 1400 });
    expect(answer.usage.calls).toBe(2);
    expect(premiumUsage('p3').calls).toBe(0);
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

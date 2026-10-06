import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '../../components/BrandLogo';
import ChatPanel from '../../components/ChatPanel';
import SoundMixer from '../../components/SoundMixer';
import GoldButton from '../../components/GoldButton';
import ThemeToggle from '../../components/ThemeToggle';
import { premiumAdvisor } from '../../services/premiumAi';
import { transportKind } from '../../services/roomTransport';
import { playSfx } from '../../services/sfx';
import { RESOURCES, RESOURCE_LABELS } from './catanBoard';
import GameEngine, { AI_CALL_BUDGET, DEFAULT_TIMING, createInitialState } from './catanEngine';
import {
  COSTS,
  DEV_CARDS,
  bundleSize,
  hasResources,
  hiddenPoints,
  legalCitySpots,
  legalRoadSpots,
  legalSettlementSpots,
  maritimeRates,
  piecesLeft,
  publicPoints,
  redactFor,
  tradeShapeProblem,
  visibleHandSize,
} from './catanRules';
import { DevRow, ResourceRow } from './GameCards.jsx';
import GameToasts from './GameToasts.jsx';
import { settingsOf, timerLabel } from './gameSettings';
import HexBoard, { ResourceIcon } from './hexArt.jsx';
import {
  ArmyIcon,
  AwayIcon,
  CardsIcon,
  ComputerIcon,
  KnightIcon,
  LongestRoadIcon,
  PersonIcon,
  PieceIcon,
  RoadIcon,
  ScrollIcon,
  SparkIcon,
  SunIcon,
} from './tableIcons.jsx';
import { PieceMark } from './pieces.jsx';
import './board-game.css';

import winnerSound from '../../assets/sounds/Winner.mp3';

const PIP_LAYOUT = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

export function DieFace({ value }) {
  return (
    <svg className={`die-face ${value ? '' : 'die-face--idle'}`} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="3" y="3" width="94" height="94" rx="22" />
      {(PIP_LAYOUT[value] || []).map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="8.5" />
      ))}
    </svg>
  );
}

// Automated tests on the local transport can run a match at high speed.
const testTiming = () => {
  if (transportKind() !== 'local' || !window.location.search.includes('speed=fast')) {
    return {};
  }

  return Object.fromEntries(Object.entries(DEFAULT_TIMING).map(([key, value]) => [key, Math.round(value * 0.05)]));
};

const kindLabel = (player) => {
  if (player.kind === 'bot') return 'Computer opponent';
  if (player.kind === 'ai') return 'AI opponent';
  if (player.away) return 'Away, the computer is playing';
  return player.id === 'p1' ? 'Host' : 'Player';
};

const emptyBundle = () => ({ brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 });

// The fullscreen API is missing or blocked in some browsers and frames.
const toggleFullscreen = () => {
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  } catch {
    // Nothing to do, the layout already fills the window.
  }
};

// Time left on an engine clock, ticking locally between snapshots.
function useCountdown(endsAt) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!endsAt) {
      return undefined;
    }

    const timer = setInterval(() => setTick((tick) => tick + 1), 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  return endsAt ? Math.max(0, endsAt - Date.now()) : 0;
}

// A ticking number of seconds. Only this small element re-renders each
// tick, never the board.
function Countdown({ endsAt, render }) {
  const left = useCountdown(endsAt);
  return render(Math.ceil(left / 1000), left);
}

// The move clock: a ring that empties as the seconds run out, with a soft
// tick in the last five seconds when it is this player's own clock.
function TurnClock({ endsAt, length, label, mine, sound }) {
  const left = useCountdown(endsAt);
  const seconds = Math.ceil(left / 1000);
  const lastTick = useRef(null);

  useEffect(() => {
    if (!mine || !sound || seconds > 5 || seconds <= 0 || lastTick.current === seconds) return;
    lastTick.current = seconds;
    sound();
  }, [mine, sound, seconds]);

  const fraction = length ? Math.min(1, Math.max(0, left / length)) : 0;
  return (
    <div
      className={`turn-clock ${seconds <= 5 ? 'turn-clock--urgent' : ''} ${mine ? 'turn-clock--mine' : ''}`}
      role="timer"
      aria-label={`${seconds} seconds ${label}`}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="turn-clock-track" cx="20" cy="20" r="17" />
        <circle className="turn-clock-fill" cx="20" cy="20" r="17" pathLength="100" style={{ strokeDashoffset: 100 - fraction * 100 }} />
      </svg>
      <strong>{seconds}</strong>
      <span>{label}</span>
    </div>
  );
}

// The coloured role tag on a player's card.
const roleFor = (player, myPlayerId) => {
  if (player.away) return { key: 'away', label: 'Away', title: 'Disconnected, the computer is playing', icon: <AwayIcon size={13} /> };
  if (player.kind === 'bot') return { key: 'bot', label: 'Computer', title: 'Computer opponent', icon: <ComputerIcon size={13} /> };
  if (player.kind === 'ai') return { key: 'ai', label: 'AI · Claude', title: 'Premium AI opponent', icon: <SparkIcon size={13} /> };
  return {
    key: 'human',
    label: player.id === 'p1' ? 'Host' : 'Player',
    title: player.id === myPlayerId ? 'You' : 'A person at the table',
    icon: <PersonIcon size={13} />,
  };
};

// What the player is doing right now, shown as a status tag.
const STATUS_LABELS = {
  'pre-roll': 'Rolling',
  actions: 'Trading & building',
  robber: 'Moving the robber',
  steal: 'Stealing',
  'road-building': 'Free roads',
};

// Applies one player's action to the engine, whether it came from this
// screen or from a friend's intent over the network.
// A move from anyone at the table. A malformed message from a guest is
// simply refused, never allowed to throw inside the host.
export const runAction = (engine, playerId, action) => {
  try {
    return dispatchAction(engine, playerId, action);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Refused a malformed move', error);
    return false;
  }
};

const dispatchAction = (engine, playerId, action) => {
  switch (action?.type) {
    case 'roll':
      return engine.roll(playerId);
    case 'place-settlement':
      return engine.placeSettlement(playerId, Number(action.vertexId));
    case 'place-road':
      return engine.placeRoad(playerId, Number(action.edgeId));
    case 'build-city':
      return engine.buildCity(playerId, Number(action.vertexId));
    case 'buy-dev':
      return engine.buyDev(playerId);
    case 'play-dev':
      return engine.playDev(playerId, action.card, { resources: action.resources, resource: action.resource });
    case 'discard':
      return engine.discard(playerId, action.cards);
    case 'move-robber':
      return engine.moveRobber(playerId, Number(action.hexId));
    case 'steal':
      return engine.steal(playerId, action.victimId);
    case 'trade-propose':
      return engine.proposeTrade(playerId, { give: action.give, get: action.get, to: action.to || null });
    case 'trade-respond':
      return engine.respondTrade(playerId, action.tradeId, Boolean(action.accept));
    case 'trade-complete':
      return engine.completeTrade(playerId, action.tradeId, action.partnerId);
    case 'trade-cancel':
      return engine.cancelTrade(playerId, action.tradeId);
    case 'maritime':
      return engine.maritime(playerId, action.give, action.get);
    case 'end-turn':
      return engine.endTurn(playerId);
    case 'end-propose':
      return engine.proposeEnd(playerId);
    case 'end-vote':
      return engine.voteEnd(playerId, Boolean(action.agree));
    default:
      return false;
  }
};

function CostChips({ cost, size = 13 }) {
  return (
    <span className={`cost-chips ${size > 16 ? 'cost-chips--large' : ''}`}>
      {Object.entries(cost).map(([resource, count]) => (
        <span key={resource} className={`cost-chip res-${resource}`} title={`${count} ${RESOURCE_LABELS[resource]}`}>
          {Array.from({ length: count }, (_, i) => (
            <ResourceIcon key={i} resource={resource} size={size} />
          ))}
        </span>
      ))}
    </span>
  );
}

// The piece a building option makes, drawn in the player's colour.
function BuildArt({ kind, size = 28 }) {
  return (
    <span className={`build-art build-art--${kind}`} aria-hidden="true">
      {kind === 'dev' ? <ScrollIcon size={size} /> : <PieceIcon kind={kind} size={size} />}
    </span>
  );
}

const BUILDS = [
  { key: 'road', label: 'Road', note: '0 VP · builds toward Longest Road' },
  { key: 'settlement', label: 'Settlement', note: '1 VP' },
  { key: 'city', label: 'City', note: '2 VP · replaces a settlement' },
  { key: 'dev', label: 'Development card', note: 'Knight, progress or victory point' },
];

function BundleLine({ bundle }) {
  const entries = Object.entries(bundle || {}).filter(([, count]) => count > 0);
  if (!entries.length) return <span className="bundle-line bundle-line--empty">nothing</span>;
  return (
    <span className="bundle-line">
      {entries.map(([resource, count]) => (
        <span key={resource} className={`bundle-item res-${resource}`}>
          <ResourceIcon resource={resource} size={14} />
          {count}
        </span>
      ))}
    </span>
  );
}

// +/- pickers for one resource bundle.
function BundlePicker({ value, onChange, limits = null, label }) {
  return (
    <div className="bundle-picker" role="group" aria-label={label}>
      {RESOURCES.map((resource) => {
        const max = limits ? limits[resource] : 19;
        return (
          <div key={resource} className={`bundle-picker-row res-${resource}`}>
            <ResourceIcon resource={resource} size={18} />
            <span className="bundle-picker-name">{RESOURCE_LABELS[resource]}</span>
            <button
              type="button"
              aria-label={`One less ${RESOURCE_LABELS[resource]}`}
              disabled={!value[resource]}
              onClick={() => onChange({ ...value, [resource]: value[resource] - 1 })}
            >
              −
            </button>
            <strong>{value[resource]}</strong>
            <button
              type="button"
              aria-label={`One more ${RESOURCE_LABELS[resource]}`}
              disabled={value[resource] >= max}
              onClick={() => onChange({ ...value, [resource]: value[resource] + 1 })}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function BoardGame({
  players: seatPlayers,
  myPlayerId,
  session,
  audio: audioSettings = { musicOn: false, musicVolume: 0.5, effectsOn: true, effectsVolume: 0.8 },
  onAudio,
  onExit,
  onRestart,
  resume = null,
  settings = null,
}) {
  const isHost = !session || session.isHost;
  const tableOptions = settings || { board: 'beginner' };
  const [state, setState] = useState(() => {
    const cached = !isHost && session?.lastGame;
    return cached ? cached.state : resume || createInitialState(seatPlayers, { options: tableOptions });
  });
  const [connection, setConnection] = useState('online');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [sheet, setSheet] = useState(null); // 'rules' | 'costs' | 'dice' | 'end' | 'trade' | 'dev' | null
  // A spot or card chosen with a first tap, built or played by a second tap
  // on the same thing: { kind: 'road' | 'settlement' | 'city' | 'robber' |
  // 'dev' | 'play', id }
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);
  const [focus, setFocus] = useState(null); // 'road' | 'settlement' | 'city': only those spots
  const [tradeDraft, setTradeDraft] = useState(null); // { give, get, to }
  const [discardDraft, setDiscardDraft] = useState(emptyBundle);
  const [devPick, setDevPick] = useState(null); // { card, resources: [] , resource }
  const [showResults, setShowResults] = useState(true);
  const engineRef = useRef(null);

  // ------------------------------------------------------------- engine

  useEffect(() => {
    if (!isHost) {
      return undefined;
    }

    const engine = new GameEngine({
      players: seatPlayers,
      advisor: premiumAdvisor,
      timing: testTiming(),
      initialState: resume,
      options: tableOptions,
      onChange: (next) => {
        setState(next);
        session?.broadcastGame(next, redactFor);

        // Saved whenever nothing is in motion, so a host who reloads can
        // reopen the room where it was.
        if (!next.busy || next.gameOver) {
          session?.saveHostGame(next);
        }
      },
      onChat: ({ playerId, text }) => {
        if (!session) return;
        const player = engine.player(playerId);

        if (player) {
          session.postAs(player.name, player.pieceKey, text);
        } else {
          session.postSystem(text);
        }
      },
    });

    engineRef.current = engine;
    engine.start();

    // After a host resume, friends who reconnected before this board was
    // ready get their seats back straight away.
    session?.players?.forEach((player) => {
      if (player.clientId && engine.player(player.id)?.away) {
        engine.setAway(player.id, false, player.clientId);
      }
    });

    const offIntent = session?.on('intent', ({ clientId, action }) => {
      const player = engine.state.players.find((entry) => entry.clientId === clientId);

      if (player) {
        runAction(engine, player.id, action);
      }
    });

    // A dropped player keeps their seat; the computer plays it until they
    // come back with their Player ID.
    const offLeft = session?.on('peer-left', (clientId) => {
      const player = engine.state.players.find((entry) => entry.clientId === clientId);

      if (player) {
        engine.setAway(player.id, true);
      }
    });

    const offBack = session?.on('peer-rejoined', ({ clientId, playerId }) => {
      engine.setAway(playerId, false, clientId);
      session.broadcastGame(engine.state, redactFor);
    });

    return () => {
      offIntent?.();
      offLeft?.();
      offBack?.();
      engine.destroy();
      engineRef.current = null;
    };
    // The saved snapshot only seeds the first engine of this board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, seatPlayers, session]);

  // Guests mirror the host's snapshots.
  useEffect(() => {
    if (isHost || !session) {
      return undefined;
    }

    let epoch = session.lastGame?.gameId;
    const offGame = session.on('game', ({ state: next, sentAt, gameId }) => {
      // A host that reopened the room starts a new epoch from its saved
      // snapshot, which may be older than what this board last showed.
      const fresh = gameId !== epoch;
      epoch = gameId;
      setState((current) => (fresh || next.version >= current.version ? next : current));
      setClockOffset(Date.now() - sentAt);
    });
    const offConnection = session.on('connection', setConnection);

    return () => {
      offGame();
      offConnection();
    };
  }, [isHost, session]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // One way to act, whether the rules run here or on the host.
  const act = useCallback(
    (action) => {
      if (!isHost) {
        session?.sendIntent(action);
        return;
      }

      if (engineRef.current) {
        runAction(engineRef.current, myPlayerId, action);
      }
    },
    [isHost, myPlayerId, session],
  );

  // -------------------------------------------------------------- sound

  const effectsOn = audioSettings.effectsOn && audioSettings.effectsVolume > 0;
  const tickSound = useMemo(
    () => (effectsOn ? () => playSfx('tick', audioSettings.effectsVolume) : null),
    [effectsOn, audioSettings.effectsVolume],
  );
  const winnerRef = useRef(null);

  if (!winnerRef.current && typeof Audio !== 'undefined') {
    winnerRef.current = new Audio(winnerSound);
    winnerRef.current.preload = 'auto';
  }

  useEffect(() => {
    const winner = winnerRef.current;
    return () => winner?.pause();
  }, []);

  const lastSfx = useRef(state.sfx?.id ?? 0);

  useEffect(() => {
    const sfx = state.sfx;

    if (!sfx || sfx.id === lastSfx.current) {
      return;
    }

    lastSfx.current = sfx.id;

    if (!effectsOn) {
      return;
    }

    if (sfx.key === 'winner' && winnerRef.current) {
      winnerRef.current.volume = Math.min(1, Math.max(0, audioSettings.effectsVolume));
      winnerRef.current.currentTime = 0;
      winnerRef.current.play().catch(() => {});
    } else {
      playSfx(sfx.key, audioSettings.effectsVolume);
    }
  }, [state.sfx, effectsOn, audioSettings.effectsVolume]);

  // ------------------------------------------------------------ keyboard

  // A popup takes the keyboard focus when it opens, so keyboard users land
  // in it rather than on the board behind.
  useEffect(() => {
    const dialog = document.querySelector('.board-game-page [role="dialog"]');
    if (!dialog || dialog.contains(document.activeElement)) return;
    const first = dialog.querySelector('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first || dialog).focus?.({ preventScroll: true });
  });

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setSheet(null);
        pendingRef.current = null;
        setPending(null);
        setFocus(null);
        setTradeDraft(null);
        setDevPick(null);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------ derived

  // Everyone, the host included, sees only their own cards.
  const view = useMemo(() => (state.redacted ? state : redactFor(state, myPlayerId)), [state, myPlayerId]);
  const players = view.players;
  const activePlayer = players[view.activeIndex];
  const me = players.find((player) => player.id === myPlayerId);
  const isMyTurn = activePlayer?.id === myPlayerId;
  const phase = view.turnPhase;
  const over = Boolean(view.gameOver);
  const myHand = (me && view.hands[myPlayerId]) || emptyBundle();
  const myDev = (me && view.devCards[myPlayerId]) || [];
  const setupTurn = phase === 'setup' && view.setup && players[view.setup.order[view.setup.step]]?.id === myPlayerId;
  const iOweDiscard = phase === 'discard' && view.pendingDiscards?.[myPlayerId];
  const canBuildNow = isMyTurn && phase === 'actions' && !view.busy && !over;
  const deckLeft = typeof view.devDeck === 'number' ? view.devDeck : view.devDeck?.length || 0;
  const left = me ? piecesLeft(view, myPlayerId) : { road: 0, settlement: 0, city: 0 };
  const rates = me ? maritimeRates(view, myPlayerId) : {};
  // Before the roll only a Knight may be played; progress cards wait for it.
  const playableDev = myDev.filter(
    (card) =>
      card.type &&
      card.type !== 'victoryPoint' &&
      card.boughtTurn !== view.turnCount &&
      (phase === 'actions' || card.type === 'knight'),
  );
  const canPlayDev = isMyTurn && !view.busy && !over && !view.devPlayedThisTurn && (phase === 'pre-roll' || phase === 'actions');
  const myPoints = me ? publicPoints(view, myPlayerId) + hiddenPoints(view, myPlayerId) : 0;
  const rules = settingsOf(view);
  const goal = rules.victoryPoints;

  // A first tap belongs to its moment: it is dropped whenever the phase,
  // the turn or the set-up step moves on.
  const pick = useCallback((next) => {
    pendingRef.current = next;
    setPending(next);
  }, []);
  const momentKey = `${view.turnCount}:${phase}:${view.setup?.step ?? ''}:${view.setup?.expect ?? ''}:${isMyTurn}`;
  useEffect(() => {
    pick(null);
    setFocus(null);
  }, [momentKey, pick]);

  useEffect(() => {
    setDiscardDraft(emptyBundle());
  }, [iOweDiscard]);

  useEffect(() => {
    if (over) setShowResults(true);
  }, [over]);

  // What may be clicked on the board right now.
  const highlight = useMemo(() => {
    if (!me || over || view.busy) return {};
    if (setupTurn) {
      return view.setup.expect === 'settlement'
        ? { vertices: legalSettlementSpots(view, myPlayerId, { setup: true }) }
        : { edges: legalRoadSpots(view, myPlayerId, { fromVertex: view.setup.vertexId }) };
    }
    if (!isMyTurn) return {};
    if (phase === 'road-building') return { edges: legalRoadSpots(view, myPlayerId) };
    if (phase === 'robber') return { hexes: view.board.hexes.filter((hex) => hex.id !== view.board.robber).map((hex) => hex.id) };
    if (phase !== 'actions') return {};
    // Everything you can afford right now shows on the board at once.
    const hand = view.hands[myPlayerId];
    const pieces = piecesLeft(view, myPlayerId);
    const show = (kind, cost) => hasResources(hand, cost) && pieces[kind] > 0 && (!focus || focus === kind);
    return {
      browse: true,
      edges: show('road', COSTS.road) ? legalRoadSpots(view, myPlayerId) : [],
      vertices: show('settlement', COSTS.settlement) ? legalSettlementSpots(view, myPlayerId) : [],
      cities: show('city', COSTS.city) ? legalCitySpots(view, myPlayerId) : [],
    };
  }, [view, me, over, setupTurn, isMyTurn, phase, focus, myPlayerId]);

  // First tap chooses, a second tap on the same thing confirms.
  const choose = useCallback(
    (kind, id, action) => {
      const current = pendingRef.current;
      if (current && current.kind === kind && current.id === id) {
        pick(null);
        action();
      } else {
        pick({ kind, id });
      }
    },
    [pick],
  );

  const citySpots = highlight.cities;
  const onVertex = useCallback(
    (vertexId) => {
      const city = (citySpots || []).includes(vertexId);
      choose(city ? 'city' : 'settlement', vertexId, () => {
        act({ type: city ? 'build-city' : 'place-settlement', vertexId });
        setFocus(null);
      });
    },
    [act, choose, citySpots],
  );

  const onEdge = useCallback(
    (edgeId) =>
      choose('road', edgeId, () => {
        act({ type: 'place-road', edgeId });
        setFocus(null);
      }),
    [act, choose],
  );

  const onHex = useCallback((hexId) => choose('robber', hexId, () => act({ type: 'move-robber', hexId })), [act, choose]);

  // A tap on the board away from any spot lets go of the first choice.
  const onBoardClick = (event) => {
    if (!pendingRef.current) return;
    if (!event.target.closest?.('.spot, .building--upgradable, .hex-tile--target, .confirm-chip')) pick(null);
  };

  const localTime = (at) => (at ? at + (isHost ? 0 : clockOffset) : 0);
  const phaseEndsAt = localTime(view.phaseEndsAt);
  const clockIsMine = Boolean(setupTurn || iOweDiscard || (isMyTurn && phase !== 'discard'));
  const clockLabel =
    phase === 'pre-roll'
      ? 'to roll'
      : phase === 'setup'
        ? 'to place'
        : phase === 'discard'
          ? 'to discard'
          : phase === 'robber' || phase === 'steal'
            ? 'for the robber'
            : 'for this move';
  const log = view.log || [];
  const myCode = me?.code;
  const nameOf = (id) => players.find((player) => player.id === id)?.name || 'someone';
  const rolledTotal = view.dice && !view.rolling ? view.dice[0] + view.dice[1] : null;

  const voters = players.filter((player) => player.kind === 'human' && !player.away);
  const endVote = view.endVote;
  const iAmVoter = voters.some((player) => player.id === myPlayerId);
  const canProposeEnd = iAmVoter && !over && !endVote;
  const waitingOnVote = endVote ? voters.filter((player) => !endVote.agreed.includes(player.id)) : [];
  const mustVote = endVote && !endVote.passed && iAmVoter && !endVote.agreed.includes(myPlayerId);

  // Offers this player made or already answered. Offers waiting on their
  // answer pop up at the side (GameToasts) with Accept and Decline.
  const trades = (view.trades || []).filter(
    (trade) =>
      trade.from === myPlayerId ||
      ((trade.to === myPlayerId || !trade.to) && trade.responses?.[myPlayerId] !== undefined),
  );
  const canTrade = me && phase === 'actions' && !over && !view.busy;

  // A trade draft or a card choice belongs to the moment it was opened: when
  // the turn moves on, it closes rather than reappearing later.
  const activeId = activePlayer?.id;
  const tradeOpen = Boolean(me && phase === 'actions' && !over);
  useEffect(() => {
    setTradeDraft(null);
    setSheet((current) => (current === 'trade' ? null : current));
  }, [activeId, tradeOpen]);
  useEffect(() => {
    if (!canPlayDev) setDevPick(null);
  }, [canPlayDev]);

  const copyMyId = async () => {
    try {
      await navigator.clipboard.writeText(myCode);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 2000);
    } catch {
      setCopiedId(false);
    }
  };

  const openTrade = () => {
    setTradeDraft({ give: emptyBundle(), get: emptyBundle(), to: null });
    setSheet('trade');
  };

  // ------------------------------------------------------------ prompts

  const prompt = (() => {
    if (over) return 'The game is over';
    if (phase === 'setup') {
      const placer = players[view.setup.order[view.setup.step]];
      const round = view.setup.step < players.length ? 'first' : 'second';
      if (placer.id !== myPlayerId) return `${placer.name} is placing their ${round} ${view.setup.expect}`;
      return view.setup.expect === 'settlement'
        ? `Tap a glowing intersection for your ${round} settlement, then tap it again`
        : 'Tap a path next to your new settlement, then tap it again';
    }
    if (phase === 'discard') {
      if (iOweDiscard) return `A 7 was rolled, discard ${iOweDiscard} cards`;
      return `Waiting for ${Object.keys(view.pendingDiscards).map(nameOf).join(', ')} to discard`;
    }
    if (!isMyTurn) {
      if (view.thinking) return `${nameOf(view.thinking)} is thinking`;
      return activePlayer.away ? 'Away, the computer is playing' : `${kindLabel(activePlayer)} is playing`;
    }
    if (view.rolling) return 'Rolling';
    if (phase === 'pre-roll') return playableDev.some((card) => card.type === 'knight') ? 'Roll the dice, or play a Knight first' : 'Roll the dice';
    if (phase === 'robber') return pending?.kind === 'robber' ? 'Tap the same hex again to send the robber there' : 'Tap a hex for the robber, then tap it again';
    if (phase === 'steal') return 'Choose who to rob';
    if (phase === 'road-building') return `Place ${view.roadBuilding?.remaining} free road${view.roadBuilding?.remaining === 1 ? '' : 's'}: tap a path, then tap it again`;
    if (pending && ['road', 'settlement', 'city'].includes(pending.kind)) return `Tap again to build the ${pending.kind}, or tap elsewhere to cancel`;
    if ((highlight.edges || []).length || (highlight.vertices || []).length || (highlight.cities || []).length) {
      return 'Tap a glowing spot to build, tap again to confirm';
    }
    return 'Trade, or end your turn';
  })();

  // ------------------------------------------------------------- sheets

  const renderDiscard = () => {
    if (!iOweDiscard) return null;
    const chosen = bundleSize(discardDraft);
    return (
      <div className="property-card-overlay end-overlay">
        <div className="property-card discard-sheet" role="dialog" aria-modal="true" aria-labelledby="discard-title">
          <header className="property-card-header">
            <p className="property-card-kicker">The robber strikes</p>
            <h3 id="discard-title">Discard {iOweDiscard} cards</h3>
          </header>
          <div className="property-card-body">
            <p className="end-sheet-text">
              You hold more than {rules.handLimit} resource cards, so half of them (rounded down) go back to the bank
            </p>
            <BundlePicker value={discardDraft} onChange={setDiscardDraft} limits={myHand} label="Cards to discard" />
            <div className="purchase-offer-actions">
              <GoldButton disabled={chosen !== iOweDiscard} onClick={() => act({ type: 'discard', cards: discardDraft })}>
                Discard {chosen} of {iOweDiscard}
              </GoldButton>
            </div>
            {view.phaseEndsAt && (
              <Countdown
                endsAt={phaseEndsAt}
                render={(seconds) => <p className="trade-note">The computer chooses for you in {seconds} s</p>}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSteal = () => {
    if (!isMyTurn || phase !== 'steal' || over) return null;
    return (
      <div className="property-card-overlay end-overlay">
        <div className="property-card steal-sheet" role="dialog" aria-modal="true" aria-labelledby="steal-title">
          <header className="property-card-header">
            <p className="property-card-kicker">The robber</p>
            <h3 id="steal-title">Steal a card from</h3>
          </header>
          <div className="property-card-body">
            <div className="steal-options">
              {view.stealFrom.map((id) => {
                const player = players.find((entry) => entry.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`steal-option seat-${player.pieceKey}`}
                    onClick={() => act({ type: 'steal', victimId: id })}
                  >
                    <PieceMark piece={player.pieceKey} variant="token" />
                    <strong>{player.name}</strong>
                    <span>{visibleHandSize(view.hands[id])} cards</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDevPick = () => {
    if (!devPick) return null;
    const close = () => setDevPick(null);
    const isPlenty = devPick.card === 'yearOfPlenty';
    const ready = isPlenty ? devPick.resources.length === 2 : Boolean(devPick.resource);
    return (
      <div className="property-card-overlay" onClick={close}>
        <div className="property-card dev-pick-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="dev-pick-title">
          <header className="property-card-header">
            <p className="property-card-kicker">Progress card</p>
            <h3 id="dev-pick-title">{DEV_CARDS[devPick.card].label}</h3>
            <button type="button" className="property-card-close" onClick={close} aria-label="Close">
              ✕
            </button>
          </header>
          <div className="property-card-body">
            <p className="end-sheet-text">{DEV_CARDS[devPick.card].text}</p>
            <div className="resource-choice">
              {RESOURCES.map((resource) => {
                const picked = isPlenty
                  ? devPick.resources.filter((entry) => entry === resource).length
                  : devPick.resource === resource
                    ? 1
                    : 0;
                // Year of Plenty may only take what the bank can pay.
                const after = isPlenty ? [...devPick.resources, resource].slice(-2).filter((entry) => entry === resource).length : 0;
                const bankOut = isPlenty && view.bank[resource] < after;
                return (
                  <button
                    key={resource}
                    type="button"
                    className={`resource-choice-btn res-${resource} ${picked ? 'is-picked' : ''}`}
                    disabled={bankOut}
                    onClick={() =>
                      setDevPick((current) =>
                        isPlenty
                          ? { ...current, resources: [...current.resources, resource].slice(-2) }
                          : { ...current, resource },
                      )
                    }
                  >
                    <ResourceIcon resource={resource} size={22} />
                    <span>{RESOURCE_LABELS[resource]}</span>
                    {picked > 0 && <em>×{picked}</em>}
                  </button>
                );
              })}
            </div>
            <div className="purchase-offer-actions">
              <GoldButton
                disabled={!ready}
                onClick={() => {
                  act({ type: 'play-dev', card: devPick.card, resources: devPick.resources, resource: devPick.resource });
                  close();
                }}
              >
                Play card
              </GoldButton>
              {isPlenty && devPick.resources.length > 0 && (
                <GoldButton variant="ghost" onClick={() => setDevPick((current) => ({ ...current, resources: [] }))}>
                  Clear
                </GoldButton>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const playDev = (type) => {
    if (type === 'yearOfPlenty') setDevPick({ card: type, resources: [] });
    else if (type === 'monopoly') setDevPick({ card: type, resource: null });
    else act({ type: 'play-dev', card: type });
  };

  // How the bank pays for a draft: each resource given must be a whole
  // number of lots at your rate, and the lots buy exactly the cards asked
  // for. Returns the single trades to make, or a reason it does not work.
  const bankPlan = (give, get) => {
    const gives = Object.entries(give);
    const wants = Object.entries(get).flatMap(([resource, count]) => Array(count).fill(resource));
    if (!gives.length || !wants.length) return { problem: 'Pick what to give and what to get' };
    if (wants.some((resource) => give[resource])) return { problem: 'The same resource cannot be on both sides' };
    const lots = [];
    for (const [resource, count] of gives) {
      if (count % rates[resource]) {
        return { problem: `The bank takes ${RESOURCE_LABELS[resource].toLowerCase()} ${rates[resource]} at a time` };
      }
      for (let i = 0; i < count / rates[resource]; i += 1) lots.push(resource);
    }
    if (lots.length !== wants.length) {
      return { problem: `That gives ${lots.length} lot${lots.length === 1 ? '' : 's'} for ${wants.length} card${wants.length === 1 ? '' : 's'}` };
    }
    if (Object.entries(get).some(([resource, count]) => view.bank[resource] < count)) return { problem: 'The bank is out of that' };
    return { trades: lots.map((resource, i) => ({ give: resource, get: wants[i] })) };
  };

  const renderTradeSheet = () => {
    if (sheet !== 'trade' || !tradeDraft || !canTrade) return null;
    const close = () => {
      setSheet(null);
      setTradeDraft(null);
    };
    const give = Object.fromEntries(Object.entries(tradeDraft.give).filter(([, n]) => n > 0));
    const get = Object.fromEntries(Object.entries(tradeDraft.get).filter(([, n]) => n > 0));
    const others = players.filter((player) => player.id !== myPlayerId);
    const toBank = isMyTurn && tradeDraft.to === 'bank';
    const target = isMyTurn ? tradeDraft.to : activePlayer.id;
    const bank = bankPlan(give, get);
    const problem = toBank
      ? bank.problem
      : tradeShapeProblem(give, get) || (!hasResources(myHand, give) ? 'You do not have those cards' : null);
    const best = Math.min(...RESOURCES.map((resource) => rates[resource]));
    const setTo = (to) => setTradeDraft((draft) => ({ ...draft, to }));

    const send = () => {
      if (toBank) {
        bank.trades.forEach((trade) => act({ type: 'maritime', give: trade.give, get: trade.get }));
      } else {
        act({ type: 'trade-propose', give, get, to: target });
      }
      close();
    };

    return (
      <div className="property-card-overlay end-overlay" onClick={close}>
        <div className="property-card trade-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="trade-title">
          <header className="property-card-header">
            <p className="property-card-kicker">{isMyTurn ? 'Players or the bank, in one place' : `Offer to ${activePlayer.name}`}</p>
            <h3 id="trade-title">Trade</h3>
            <button type="button" className="property-card-close" onClick={close} aria-label="Close">
              ✕
            </button>
          </header>

          <div className="property-card-body">
            <div className="trade-columns">
              <div>
                <p className="trade-side-title">You give</p>
                <BundlePicker
                  value={tradeDraft.give}
                  limits={myHand}
                  label="You give"
                  onChange={(next) => setTradeDraft((draft) => ({ ...draft, give: next }))}
                />
              </div>
              <span className="trade-swap" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 8h14l-4-4M20 16H6l4 4" />
                </svg>
              </span>
              <div>
                <p className="trade-side-title">You get</p>
                <BundlePicker
                  value={tradeDraft.get}
                  label="You get"
                  onChange={(next) => setTradeDraft((draft) => ({ ...draft, get: next }))}
                />
              </div>
            </div>

            <p className="trade-side-title trade-to-title">Trade with</p>
            {isMyTurn ? (
              <div className="trade-targets" role="radiogroup" aria-label="Trade with">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!tradeDraft.to}
                  className={`trade-target ${!tradeDraft.to ? 'trade-target--active' : ''}`}
                  onClick={() => setTo(null)}
                >
                  <strong>Everyone</strong>
                  <span>Open offer</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={toBank}
                  className={`trade-target trade-target--bank ${toBank ? 'trade-target--active' : ''} ${!bank.problem ? 'trade-target--ready' : ''}`}
                  onClick={() => setTo('bank')}
                >
                  <strong>Bank</strong>
                  <span>{best}:1{best < 4 ? ' with your harbour' : ''}</span>
                </button>
                {others.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    role="radio"
                    aria-checked={tradeDraft.to === player.id}
                    className={`trade-target seat-${player.pieceKey} ${tradeDraft.to === player.id ? 'trade-target--active' : ''}`}
                    onClick={() => setTo(player.id)}
                  >
                    <strong>
                      <PieceMark piece={player.pieceKey} variant="token" /> {player.name}
                    </strong>
                    <span>{visibleHandSize(view.hands[player.id])} cards</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="trade-note">Only the player whose turn it is can trade, so this offer goes to {activePlayer.name}</p>
            )}

            {toBank && (
              <p className="trade-note">
                Your rates: {RESOURCES.map((resource) => `${RESOURCE_LABELS[resource]} ${rates[resource]}:1`).join(' · ')}
              </p>
            )}
            {problem && bundleSize(give) + bundleSize(get) > 0 && <p className="trade-problem">{problem}</p>}

            <div className="purchase-offer-actions">
              <GoldButton disabled={Boolean(problem)} onClick={send}>
                {toBank ? 'Trade with the bank' : `Send offer${target ? ` to ${nameOf(target)}` : ' to everyone'}`}
              </GoldButton>
            </div>
            {!toBank && <p className="trade-note">No gifts, and never the same resource on both sides</p>}
          </div>
        </div>
      </div>
    );
  };

  const renderResults = () => {
    if (!over || !showResults) return null;
    const result = view.gameOver;
    const winners = result.winners.map((id) => players.find((player) => player.id === id)).filter(Boolean);
    const iWon = result.winners.includes(myPlayerId);
    const headline =
      winners.length > 1
        ? `${winners.map((player) => player.name).join(' and ')} share the win`
        : iWon
          ? 'You settled Catan'
          : `${winners[0]?.name} wins`;

    return (
      <div className="property-card-overlay results-overlay">
        <div className="property-card results-sheet" role="dialog" aria-modal="true" aria-labelledby="results-title">
          <div className="results-hero">
            <span className="results-crown" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 17h16M5 17 3.5 8l5 3.5L12 5l3.5 6.5 5-3.5L19 17M6 20h12" />
              </svg>
            </span>
            <p className="property-card-kicker">
              {result.reason === 'agreed' ? 'Ended by agreement' : `Victory with ${goal} or more points`}
            </p>
            <h3 id="results-title">{headline}</h3>
            <p className="results-sub">Every point counts, hidden victory point cards are now revealed</p>
          </div>

          <ol className="results-table">
            {result.standings.map((entry, index) => (
              <li
                key={entry.id}
                className={`results-row ${result.winners.includes(entry.id) ? 'results-row--winner' : ''}`}
                style={{ '--reveal-delay': `${index * 0.12}s` }}
              >
                <span className="results-rank">{index + 1}</span>
                <span className={`results-token seat-${entry.pieceKey}`}>
                  <PieceMark piece={entry.pieceKey} variant="token" title={entry.name} />
                </span>
                <span className="results-name">
                  <strong>
                    {entry.name}
                    {entry.id === myPlayerId ? ' (You)' : ''}
                  </strong>
                  <span>
                    {[
                      `${entry.settlements} settlement${entry.settlements === 1 ? '' : 's'}`,
                      `${entry.cities} cit${entry.cities === 1 ? 'y' : 'ies'}`,
                      entry.longestRoad && 'Longest Road',
                      entry.largestArmy && 'Largest Army',
                      entry.victoryCards && `${entry.victoryCards} VP card${entry.victoryCards === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="results-worth">
                  <span>Points</span>
                  <strong>{entry.points}</strong>
                </span>
              </li>
            ))}
          </ol>

          <div className="results-actions">
            {isHost && onRestart && <GoldButton onClick={onRestart}>Play again</GoldButton>}
            <GoldButton variant="ghost" onClick={() => setShowResults(false)}>
              View the board
            </GoldButton>
            <button type="button" className="text-link" onClick={onExit}>
              Back to home
            </button>
          </div>
          {!isHost && <p className="results-wait">The host can start a rematch for everyone</p>}
        </div>
      </div>
    );
  };

  const renderInfoSheet = () => {
    if (!['rules', 'costs', 'dice'].includes(sheet)) return null;
    const close = () => setSheet(null);
    return (
      <div className="property-card-overlay" onClick={close}>
        <div className="property-card dice-info-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="info-title">
          <header className="property-card-header">
            <p className="property-card-kicker">{sheet === 'dice' ? 'Fair play' : 'Reference'}</p>
            <h3 id="info-title">{sheet === 'rules' ? 'How a turn works' : sheet === 'costs' ? 'Building costs' : 'Dice and island'}</h3>
            <button type="button" className="property-card-close" onClick={close} aria-label="Close">
              ✕
            </button>
          </header>
          <div className="property-card-body dice-info-body">
            {sheet === 'rules' && (
              <>
                <div className="property-card-section">
                  <h4>1. Roll for resources</h4>
                  <p>
                    Every hex with the rolled number pays each settlement next to it 1 card and each city 2 cards, unless the
                    robber sits on it. A 7 pays nothing: anyone with more than {rules.handLimit} cards discards half, then you move the robber
                    and steal a card.
                  </p>
                </div>
                <div className="property-card-section">
                  <h4>2. Trade</h4>
                  <p>
                    Trade with the other players (only with the player whose turn it is), or with the bank at 4:1, 3:1 at a
                    generic harbour or 2:1 at a special harbour.
                  </p>
                </div>
                <div className="property-card-section">
                  <h4>3. Build</h4>
                  <p>
                    Roads connect to your network. Settlements need a road and the Distance Rule: no building on any
                    neighbouring intersection. Cities upgrade settlements. You may play one development card per turn, but not
                    one bought this turn.
                  </p>
                </div>
                <div className="property-card-section">
                  <h4>Winning</h4>
                  <p>
                    The first player with {goal} victory points on their own turn wins. Settlement 1, city 2, Longest
                    Road (5+ roads) 2, Largest Army (3+ knights) 2, victory point card 1.
                  </p>
                </div>
                <div className="property-card-section">
                  <h4>This table</h4>
                  <ul className="table-rules-list">
                    <li>
                      <span>Turn timer</span>
                      <strong>
                        {rules.turnSeconds
                          ? `${timerLabel(rules.turnSeconds)} to roll, then ${timerLabel(rules.turnSeconds)} per move`
                          : 'Off'}
                      </strong>
                    </li>
                    <li>
                      <span>Discard on a 7</span>
                      <strong>More than {rules.handLimit} cards</strong>
                    </li>
                    <li>
                      <span>Victory</span>
                      <strong>{goal} points</strong>
                    </li>
                    {rules.board === 'random' && (
                      <li>
                        <span>Number tokens</span>
                        <strong>
                          {[
                            rules.redsMayTouch ? '6 and 8 may touch' : '6 and 8 kept apart',
                            rules.extremesMayTouch ? '2 and 12 may touch' : '2 and 12 kept apart',
                          ].join(' · ')}
                        </strong>
                      </li>
                    )}
                  </ul>
                </div>
              </>
            )}
            {sheet === 'costs' && (
              <ul className="costs-list">
                {BUILDS.map((build) => (
                  <li key={build.key}>
                    <BuildArt kind={build.key} size={32} />
                    <strong>{build.label}</strong>
                    <CostChips cost={COSTS[build.key]} size={22} />
                    <span>{build.note}</span>
                  </li>
                ))}
              </ul>
            )}
            {sheet === 'dice' && (
              <>
                <p className="dice-info-intro">
                  Dice are rolled on the host with the cryptographically secure generator built into the browser, so every
                  roll is fair and unpredictable
                </p>
                {view.boardId && (
                  <div className="property-card-section island-id">
                    <h4>This island</h4>
                    <p>
                      <code className="island-code">Island {view.boardId}</code>
                    </p>
                    <p>
                      {rules.board === 'random'
                        ? 'Terrain, numbers and harbours were shuffled for this game with the same secure generator. The code is a SHA-256 fingerprint of the layout: a different island always gets a different code, so you can compare it with the islands of earlier games'
                        : 'The beginners\u2019 map from the rulebook is always the same island, so it always has this code. Choose Random island before the game for a freshly shuffled one'}
                    </p>
                  </div>
                )}
                <div className="property-card-section">
                  <h4>Perfectly fair with rejection sampling</h4>
                  <p>
                    Random bytes run from 0 to 255, and 256 does not divide evenly by 6, so any byte of 252 or more is drawn
                    again, leaving exactly 42 values per face
                  </p>
                </div>
                <div className="property-card-section">
                  <h4>Odds for two dice</h4>
                  <ul className="dice-probability-list">
                    <li><strong>7</strong> 17%, the robber&apos;s number</li>
                    <li><strong>6 and 8</strong> 14% each, the red numbers</li>
                    <li><strong>5 and 9</strong> 11% · <strong>4 and 10</strong> 8%</li>
                    <li><strong>3 and 11</strong> 6% · <strong>2 and 12</strong> 3%</li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ------------------------------------------------------------- render

  const statusFor = (player, { active, placing }) => {
    if (view.thinking === player.id) return { key: 'thinking', label: 'Asking Claude' };
    if (placing) return { key: 'turn', label: 'Placing' };
    if (phase === 'discard' && view.pendingDiscards?.[player.id]) return { key: 'alert', label: 'Discarding' };
    if (active) return { key: 'turn', label: STATUS_LABELS[phase] || 'Taking a turn' };
    return null;
  };

  return (
    <main className="board-game-page">
      <header className="board-topbar">
        <button className="lobby-brand" type="button" onClick={onExit} aria-label="Leave the game">
          <BrandLogo size={22} />
        </button>

        <div className="round-indicator">
          {phase === 'setup' && view.setup ? (
            <>
              <span>Set-up</span>
              <strong>{`${view.setup.step + 1}/${view.setup.order.length}`}</strong>
              <span>·</span>
            </>
          ) : null}
          <span>First to</span>
          <strong>{goal}</strong>
          <span className="round-goal-long">victory points wins</span>
          <span className="round-goal-short">VP wins</span>
          <button
            type="button"
            className="match-info-button"
            onClick={() => setSheet('rules')}
            aria-label="How a turn works"
            title="How a turn works"
          >
            i
          </button>
        </div>

        <div className="board-topbar-actions">
          {session && (
            <span className="room-code-pill" title="Room code">
              {session.code}
            </span>
          )}
          <button
            type="button"
            className="topbar-icon-button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Leave full screen' : 'Full screen'}
            title={isFullscreen ? 'Leave full screen' : 'Full screen'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {isFullscreen ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              )}
            </svg>
          </button>
          {onAudio && <SoundMixer audio={audioSettings} onAudio={onAudio} />}
          <ThemeToggle />
          {canProposeEnd && (
            <button className="end-game-button" type="button" onClick={() => setSheet('end')}>
              End game
            </button>
          )}
          <button className="lobby-back" type="button" onClick={onExit}>
            Exit game
          </button>
        </div>
      </header>

      {connection !== 'online' && (
        <div className="reconnect-banner" role="status" aria-live="polite">
          <span className="waiting-pulse" aria-hidden="true" />
          Reconnecting to the table with your Player ID {myCode}
        </div>
      )}

      {me && (
        <GameToasts view={view} myPlayerId={myPlayerId} act={act} players={players} myHand={myHand} localTime={localTime} />
      )}

      <section className="board-game-layout">
        <aside className="board-side">
          <section className="player-panel" aria-label="Players">
            <div className="player-panel-head">
              <p className="eyebrow">The table</p>
              <span className="player-panel-goal">
                <SunIcon size={14} /> {goal} to win
              </span>
            </div>

            <div className="player-list">
              {players.map((player, index) => {
                const active = index === view.activeIndex && !over && phase !== 'setup';
                const placing = phase === 'setup' && view.setup && players[view.setup.order[view.setup.step]]?.id === player.id;
                const hidden = player.id === myPlayerId ? hiddenPoints(view, player.id) : 0;
                const points = publicPoints(view, player.id) + hidden;
                const left = piecesLeft(view, player.id);
                const status = statusFor(player, { active, placing });
                const role = roleFor(player, myPlayerId);
                return (
                  <article
                    className={`seat-card seat-${player.pieceKey} ${active || placing ? 'seat-card--active' : ''} ${player.away ? 'seat-card--away' : ''}`}
                    key={player.id}
                  >
                    <div className="seat-card-head">
                      <span className="seat-avatar">
                        <PieceMark piece={player.pieceKey} variant="token" title={player.name} />
                      </span>

                      <div className="seat-card-name">
                        <strong>{player.name}</strong>
                        <div className="seat-tags">
                          {player.id === myPlayerId && <span className="seat-tag seat-tag--you">You</span>}
                          <span className={`seat-tag seat-tag--${role.key}`} title={role.title}>
                            {role.icon}
                            {role.label}
                          </span>
                          {status && <span className={`seat-tag seat-tag--status seat-tag--${status.key}`}>{status.label}</span>}
                        </div>
                      </div>

                      <span
                        className="vp-medal"
                        style={{ '--vp': Math.min(1, points / goal) }}
                        title={`${points} of ${goal} victory points${hidden ? `, ${hidden} hidden from the others` : ''}`}
                      >
                        <svg viewBox="0 0 40 40" aria-hidden="true">
                          <circle className="vp-medal-track" cx="20" cy="20" r="17" />
                          <circle className="vp-medal-fill" cx="20" cy="20" r="17" pathLength="100" />
                        </svg>
                        <strong>{points}</strong>
                        <span>VP</span>
                      </span>
                    </div>

                    <ul className="stat-tags">
                      <li className="stat-tag stat-tag--cards" title="Resource cards in hand">
                        <CardsIcon /> {visibleHandSize(view.hands[player.id])}
                        <em>cards</em>
                      </li>
                      <li className="stat-tag stat-tag--dev" title="Development cards in hand">
                        <ScrollIcon /> {(view.devCards[player.id] || []).length}
                        <em>dev</em>
                      </li>
                      <li className="stat-tag stat-tag--knights" title="Knights played">
                        <KnightIcon /> {view.knights[player.id] || 0}
                        <em>knights</em>
                      </li>
                      <li className="stat-tag stat-tag--road" title="Longest continuous road">
                        <RoadIcon /> {view.longestRoad.lengths[player.id] || 0}
                        <em>road</em>
                      </li>
                    </ul>

                    <div className="seat-card-foot">
                      <span className="pieces-left" title="Pieces left to build: settlements, cities, roads">
                        <span><PieceIcon kind="settlement" size={12} />{left.settlement}</span>
                        <span><PieceIcon kind="city" size={12} />{left.city}</span>
                        <span><PieceIcon kind="road" size={12} />{left.road}</span>
                      </span>
                      {view.longestRoad.holder === player.id && (
                        <span className="award-pill" title="Longest Road, 2 victory points">
                          <LongestRoadIcon size={16} /> Longest Road
                        </span>
                      )}
                      {view.largestArmy === player.id && (
                        <span className="award-pill" title="Largest Army, 2 victory points">
                          <ArmyIcon size={16} /> Largest Army
                        </span>
                      )}
                    </div>

                    {(active || placing) && phase !== 'discard' && view.phaseEndsAt && view.phaseLength && (
                      <span
                        key={view.phaseEndsAt}
                        className="seat-clock"
                        aria-hidden="true"
                        style={{
                          '--clock-from': Math.min(1, Math.max(0, (phaseEndsAt - Date.now()) / view.phaseLength)),
                          '--clock-ms': `${Math.max(0, phaseEndsAt - Date.now())}ms`,
                        }}
                      />
                    )}

                    {player.kind === 'ai' && view.aiUsage?.[player.id] && (
                      <p className="ai-usage" title="Claude calls and tokens this game">
                        Claude {Math.min(view.aiUsage[player.id].calls, AI_CALL_BUDGET)}/{AI_CALL_BUDGET} calls ·{' '}
                        {Math.round((view.aiUsage[player.id].tokens || 0) / 100) / 10}k tokens
                      </p>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="bank-row" aria-label="The bank">
              <span className="bank-row-label">Bank</span>
              {RESOURCES.map((resource) => (
                <span key={resource} className={`bank-chip res-${resource}`} title={`${view.bank[resource]} ${RESOURCE_LABELS[resource]} left`}>
                  <ResourceIcon resource={resource} size={14} />
                  {view.bank[resource]}
                </span>
              ))}
              <span className="bank-chip bank-chip--dev" title={`${deckLeft} development cards left`}>
                <ScrollIcon size={14} />
                {deckLeft}
              </span>
            </div>
          </section>

          {session && <ChatPanel session={session} compact />}

          <section className="activity-log" aria-label="Activity log">
            <p className="eyebrow">Activity</p>
            {log.length === 0 ? (
              <p className="activity-empty">{view.activity}</p>
            ) : (
              <ol aria-live="polite">
                {[...log].reverse().map((entry) => {
                  const actor = players.find((player) => player.id === entry.playerId);
                  return (
                    <li key={entry.id} className={actor ? `seat-${actor.pieceKey}` : ''}>
                      <span className="activity-dot" aria-hidden="true" />
                      {entry.text}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>

        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
        <section className="game-board-area catan-board-area" aria-label="Catan game board" onClick={onBoardClick}>
          <p className="board-prompt" aria-live="polite">
            {prompt}
          </p>
          <HexBoard
            board={view.board}
            buildings={view.buildings}
            roads={view.roads}
            players={players}
            highlight={highlight}
            onVertex={onVertex}
            onEdge={onEdge}
            onHex={onHex}
            selected={pending}
            myPiece={me?.pieceKey}
            rolled={phase === 'actions' && rolledTotal !== 7 ? rolledTotal : null}
          />

          {renderDiscard()}
          {renderSteal()}
          {renderDevPick()}
          {renderTradeSheet()}
          {renderInfoSheet()}
          {renderResults()}

          {sheet === 'end' && canProposeEnd && (
            <div className="property-card-overlay end-overlay" onClick={() => setSheet(null)}>
              <div className="property-card end-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="end-title">
                <header className="property-card-header">
                  <p className="property-card-kicker">End the game early</p>
                  <h3 id="end-title">End the game for everyone?</h3>
                  <button type="button" className="property-card-close" onClick={() => setSheet(null)} aria-label="Close">
                    ✕
                  </button>
                </header>
                <div className="property-card-body">
                  <p className="end-sheet-text">
                    {voters.length > 1
                      ? `Every player at the table must agree, ${voters
                          .filter((player) => player.id !== myPlayerId)
                          .map((player) => player.name)
                          .join(' and ')} will be asked`
                      : 'You are the only person at the table, the game ends as soon as you confirm'}
                  </p>
                  <p className="end-sheet-text">The win goes to the most victory points right now, hidden cards included</p>
                  <div className="purchase-offer-actions">
                    <GoldButton
                      onClick={() => {
                        act({ type: 'end-propose' });
                        setSheet(null);
                      }}
                    >
                      {voters.length > 1 ? 'Ask the table' : 'End game'}
                    </GoldButton>
                    <GoldButton variant="ghost" onClick={() => setSheet(null)}>
                      Keep playing
                    </GoldButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mustVote && (
            <div className="property-card-overlay end-overlay">
              <div className="property-card end-sheet" role="dialog" aria-modal="true" aria-labelledby="vote-title">
                <header className="property-card-header">
                  <p className="property-card-kicker">A vote at the table</p>
                  <h3 id="vote-title">{nameOf(endVote.proposerId)} wants to end the game</h3>
                </header>
                <div className="property-card-body">
                  <p className="end-sheet-text">If everyone agrees the game ends now and the most victory points wins</p>
                  <ol className="end-vote-list">
                    {voters.map((player) => (
                      <li key={player.id} className={endVote.agreed.includes(player.id) ? 'is-agreed' : ''}>
                        <span className={`seat-${player.pieceKey}`}>
                          <PieceMark piece={player.pieceKey} variant="token" />
                        </span>
                        {player.id === myPlayerId ? 'You' : player.name}
                        <em>{endVote.agreed.includes(player.id) ? 'Agreed' : 'Deciding'}</em>
                      </li>
                    ))}
                  </ol>
                  <div className="purchase-offer-actions">
                    <GoldButton onClick={() => act({ type: 'end-vote', agree: true })}>Agree to end</GoldButton>
                    <GoldButton variant="ghost" onClick={() => act({ type: 'end-vote', agree: false })}>
                      Keep playing
                    </GoldButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="turn-panel">
          <p className="eyebrow">{phase === 'setup' ? 'Set-up' : 'Current turn'}</p>

          <div className="turn-player">
            <span className={`turn-token seat-${activePlayer.pieceKey}`}>
              <PieceMark piece={activePlayer.pieceKey} variant="token" title={activePlayer.name} />
            </span>
            <div>
              <strong>{activePlayer.id === myPlayerId ? 'Your turn' : activePlayer.name}</strong>
              <span>{view.activity}</span>
            </div>
          </div>

          <div
            className={`dice-display ${view.rolling ? 'dice-display--rolling' : ''}`}
            aria-live="polite"
            aria-label={view.dice ? `Rolled ${view.dice[0]} and ${view.dice[1]}` : 'Dice ready'}
          >
            <div className="dice-pair">
              <DieFace value={view.dice?.[0]} />
              <DieFace value={view.dice?.[1]} />
            </div>
            <span className="dice-total">
              {view.dice ? `Total ${view.dice[0] + view.dice[1]}` : view.rolling ? 'Rolling' : 'Ready to roll'}
            </span>
          </div>

          {view.phaseEndsAt && !over && (
            <TurnClock
              endsAt={phaseEndsAt}
              length={view.phaseLength}
              label={clockLabel}
              mine={clockIsMine}
              sound={tickSound}
            />
          )}

          {isMyTurn && phase === 'pre-roll' && !over ? (
            <GoldButton loading={view.busy} disabled={view.busy} onClick={() => act({ type: 'roll' })}>
              Roll the dice
            </GoldButton>
          ) : canBuildNow ? (
            <GoldButton
              onClick={() => {
                pick(null);
                act({ type: 'end-turn' });
              }}
            >
              End turn
            </GoldButton>
          ) : (
            <GoldButton disabled loading={isMyTurn && view.busy}>
              {over
                ? 'Game complete'
                : setupTurn || (isMyTurn && ['robber', 'road-building'].includes(phase))
                  ? 'Your move on the board'
                  : iOweDiscard
                    ? 'Discard your cards'
                    : isMyTurn && phase === 'steal'
                      ? 'Choose who to rob'
                      : phase === 'discard'
                        ? 'Waiting for discards'
                        : `Waiting for ${phase === 'setup' ? players[view.setup.order[view.setup.step]]?.name : activePlayer.name}`}
            </GoldButton>
          )}

          {me && (
            <section className="hand-panel" aria-label="Your cards">
              <div className="hand-head">
                <p className="eyebrow">Your hand</p>
                <span className="hand-points">
                  {bundleSize(myHand)} card{bundleSize(myHand) === 1 ? '' : 's'} · {myPoints} VP
                  {hiddenPoints(view, myPlayerId) ? ` (${hiddenPoints(view, myPlayerId)} hidden)` : ''}
                </span>
              </div>
              <ResourceRow hand={myHand} />
              <DevRow
                cards={myDev}
                turnCount={view.turnCount}
                canPlay={canPlayDev}
                playable={playableDev}
                onPlay={(type) => choose('play', type, () => playDev(type))}
                selected={pending?.kind === 'play' ? pending.id : null}
                deck={
                  canBuildNow
                    ? {
                        left: deckLeft,
                        ready: hasResources(myHand, COSTS.dev) && deckLeft > 0,
                        selected: pending?.kind === 'dev',
                        onBuy: () => choose('dev', 'deck', () => act({ type: 'buy-dev' })),
                      }
                    : null
                }
              />
              {view.devPlayedThisTurn && isMyTurn && myDev.length > 0 && (
                <p className="trade-note">One development card per turn, already played</p>
              )}
            </section>
          )}

          {canBuildNow && (
            <section className={`build-guide seat-${me.pieceKey}`} aria-label="Build">
              <div className="build-guide-head">
                <p className="eyebrow">Build on the board</p>
                <span>Tap a spot, tap again</span>
              </div>
              <ul>
                {[
                  ['road', 'Road', COSTS.road, left.road, legalRoadSpots(view, myPlayerId).length],
                  ['settlement', 'Settlement', COSTS.settlement, left.settlement, legalSettlementSpots(view, myPlayerId).length],
                  ['city', 'City', COSTS.city, left.city, legalCitySpots(view, myPlayerId).length],
                ].map(([key, label, cost, piecesRemaining, spots]) => {
                  const ready = hasResources(myHand, cost) && piecesRemaining > 0 && spots > 0;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={`build-chip ${ready ? 'build-chip--ready' : ''} ${focus === key ? 'build-chip--focus' : ''}`}
                        disabled={!ready}
                        aria-pressed={focus === key}
                        onClick={() => setFocus((current) => (current === key ? null : key))}
                        title={
                          ready
                            ? `Show only where a ${label.toLowerCase()} can go`
                            : !hasResources(myHand, cost)
                              ? 'Not enough resources'
                              : piecesRemaining <= 0
                                ? 'No pieces left'
                                : 'Nowhere to build'
                        }
                      >
                        <BuildArt kind={key} size={20} />
                        <span className="build-chip-name">
                          {label}
                          <em>{piecesRemaining} left</em>
                        </span>
                        <CostChips cost={cost} size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {trades.length > 0 && !over && (
            <section className="trade-pending" aria-label="Trade offers">
              <p className="eyebrow">Trade offers</p>
              <ul>
                {trades.map((trade) => {
                  const mine = trade.from === myPlayerId;
                  const answered = trade.responses?.[myPlayerId];
                  const accepters = Object.entries(trade.responses || {})
                    .filter(([, yes]) => yes)
                    .map(([id]) => id);
                  return (
                    <li key={trade.id} className="trade-offer">
                      <p>
                        <strong>{mine ? 'You' : nameOf(trade.from)}</strong> {mine ? 'offer' : 'offers'}{' '}
                        <BundleLine bundle={trade.give} /> for <BundleLine bundle={trade.get} />
                        {trade.to ? ` to ${trade.to === myPlayerId ? 'you' : nameOf(trade.to)}` : ' to everyone'}
                      </p>
                      {mine ? (
                        <div className="trade-offer-actions">
                          {accepters.map((id) => (
                            <button key={id} type="button" className="property-action-btn" onClick={() => act({ type: 'trade-complete', tradeId: trade.id, partnerId: id })}>
                              Trade with {nameOf(id)}
                            </button>
                          ))}
                          {!accepters.length && (
                            <span className="trade-note">
                              {Object.values(trade.responses || {}).length ? 'Declined so far' : 'Waiting for answers'}
                            </span>
                          )}
                          {accepters.length === 1 && !trade.to && !trade.choosing && (
                            <span className="trade-note">Trading in a moment</span>
                          )}
                          <button type="button" className="text-link" onClick={() => act({ type: 'trade-cancel', tradeId: trade.id })}>
                            Withdraw
                          </button>
                        </div>
                      ) : answered === undefined ? (
                        <div className="trade-offer-actions">
                          <button
                            type="button"
                            className="property-action-btn"
                            disabled={!hasResources(myHand, trade.get)}
                            onClick={() => act({ type: 'trade-respond', tradeId: trade.id, accept: true })}
                          >
                            Accept
                          </button>
                          <button type="button" className="text-link" onClick={() => act({ type: 'trade-respond', tradeId: trade.id, accept: false })}>
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="trade-note">{answered ? `You accepted, waiting for ${nameOf(trade.from)}` : 'You declined'}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {canTrade && (
            <button type="button" className="view-cards-button trade-button" onClick={openTrade}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 8h14l-4-4M20 16H6l4 4" />
              </svg>
              {isMyTurn ? 'Trade' : `Make an offer to ${activePlayer.name}`}
            </button>
          )}

          {endVote && !over && !mustVote && (
            <div className={`end-vote-status ${endVote.passed ? 'end-vote-status--passed' : ''}`} aria-live="polite">
              <p className="eyebrow">{endVote.passed ? 'Game ending' : 'Vote to end the game'}</p>
              <p>
                {endVote.passed
                  ? 'Everyone agreed, the final standings appear in a moment'
                  : `Waiting for ${waitingOnVote.map((player) => player.name).join(' and ')} to agree`}
              </p>
              {!endVote.passed && iAmVoter && (
                <button type="button" className="text-link" onClick={() => act({ type: 'end-vote', agree: false })}>
                  Cancel the vote
                </button>
              )}
            </div>
          )}

          {over && !showResults && (
            <button type="button" className="text-link results-reopen" onClick={() => setShowResults(true)}>
              Show final standings <span aria-hidden="true">›</span>
            </button>
          )}

          <div className="dice-info-row">
            <button type="button" className="dice-info-button" onClick={() => setSheet('costs')}>
              Building costs
            </button>
            <button type="button" className="dice-info-button" onClick={() => setSheet('dice')}>
              Fair play{view.boardId ? ` · Island ${view.boardId.slice(0, 4)}` : ''}
            </button>
            {/* Phones hide the top bar's goal pill, so the turn guide lives here too */}
            <button type="button" className="dice-info-button dice-info-button--rules" onClick={() => setSheet('rules')}>
              How a turn works
            </button>
          </div>

          {session && (
            <section className="player-ids" aria-label="Player IDs">
              <div className="player-ids-head">
                <p className="eyebrow">Player IDs</p>
                {myCode && (
                  <button type="button" className="text-link" onClick={copyMyId}>
                    {copiedId ? 'Copied' : 'Copy mine'}
                  </button>
                )}
              </div>
              <ul>
                {/* The host keeps every Player ID to help a friend back in; a guest sees only their own. */}
                {(isHost ? state.players : players)
                  .filter((player) => player.code)
                  .map((player) => (
                    <li key={player.id} className={`seat-${player.pieceKey} ${player.id === myPlayerId ? 'is-mine' : ''}`}>
                      <PieceMark piece={player.pieceKey} variant="token" />
                      <span>{player.id === myPlayerId ? 'You' : player.name}</span>
                      <code>{player.code}</code>
                    </li>
                  ))}
              </ul>
              <p className="player-ids-note">Dropped out? Open Catan, choose Rejoin and enter the room code with your Player ID</p>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}


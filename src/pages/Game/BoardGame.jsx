import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AnimatedBalance from '../../components/AnimatedBalance';
import BrandLogo, { BrandMark } from '../../components/BrandLogo';
import ChatPanel from '../../components/ChatPanel';
import SoundMixer from '../../components/SoundMixer';
import GoldButton from '../../components/GoldButton';
import { premiumAdvisor } from '../../services/premiumAi';
import { BOARD_GRID, BOARD_SPACES } from './boardData';
import * as Estate from './estate';
import { transportKind } from '../../services/roomTransport';
import GameEngine, {
  AUCTION_INCREMENT,
  AUCTION_MIN_BID,
  DEFAULT_TIMING,
  DETENTION_FINE,
  DETENTION_MAX_ATTEMPTS,
  TAXES,
  createInitialState,
  familyHasBuildings,
  liftCost,
  mortgageFee,
  tradeProblem,
} from './gameEngine';
import { START_REWARD, TOTAL_MATCH_TURNS } from './matchRules';
import { PIECES, PieceMark } from './pieces.jsx';
import ThemeToggle from '../../components/ThemeToggle';
import TileArt from './tileArt.jsx';
import './board-game.css';

import coronationSound from '../../assets/sounds/coronation.mp3';
import pallavanExpressSound from '../../assets/sounds/Pallavan Superfast Express.mp3';
import propertyBoughtSound from '../../assets/sounds/property bought.mp3';
import farakkaExpressSound from '../../assets/sounds/The Farakka Express.mp3';
import utilitySound from '../../assets/sounds/utility.mp3';
import winnerSound from '../../assets/sounds/Winner.mp3';

// Kept for the landing page, which draws its preview from the board data.
export { BOARD_SPACES, BOARD_GRID };
export { STARTING_BALANCE } from './boardData';

const SOUND_FILES = {
  coronation: coronationSound,
  pallavanExpress: pallavanExpressSound,
  farakkaExpress: farakkaExpressSound,
  propertyBought: propertyBoughtSound,
  utility: utilitySound,
  winner: winnerSound,
};

const { routeDetails, utilityDetails, propertyDetails } = Estate;

const getSpaceClass = (space) =>
  `board-space--${space.type} ${space.colorGroup ? `board-space--${space.colorGroup}` : ''}`;

const formatCurrency = (amount) => `₹${Math.round(amount / 1000).toLocaleString('en-IN')}K`;
const formatRupees = (amount) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

const PIP_LAYOUT = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

function DieFace({ value }) {
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

  return Object.fromEntries(
    Object.entries(DEFAULT_TIMING).map(([key, value]) => [key, key === 'auction' ? 1500 : Math.round(value * 0.04)]),
  );
};

const kindLabel = (player) => {
  if (player.kind === 'bot') return 'Computer opponent';
  if (player.kind === 'ai') return 'AI opponent';
  if (player.away) return 'Away, the computer is playing';
  return player.id === 'p1' ? 'Host' : 'Player';
};

// Long city names on the narrow top and bottom row tiles get a smaller type
// size so they never break in the middle of a word.
const nameFit = (space) => {
  const narrow = space.id % 20 !== 0 && space.id % 20 < 10;
  const longest = Math.max(...space.name.split(' ').map((word) => word.length));

  if (!narrow) return '';
  if (longest >= 11) return 'space-name--xlong';
  if (longest >= 9) return 'space-name--long';
  return longest >= 7 ? 'space-name--mid' : '';
};

const spaceAccent = (space) =>
  space.colorGroup ? `var(--color-${space.colorGroup})` : space.type === 'route' ? '#2f6170' : '#a46f17';

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

// Time left on an engine clock (auction, pop up or building window),
// ticking locally between snapshots. Read against the current time on every
// render, so a clock that has just started never shows a stale value.
function useCountdown(endsAt) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!endsAt) {
      return undefined;
    }

    const timer = setInterval(() => setTick((tick) => tick + 1), 100);
    return () => clearInterval(timer);
  }, [endsAt]);

  return endsAt ? Math.max(0, endsAt - Date.now()) : 0;
}

// A small ring that empties as a pop up's time runs out. The browser
// animates it, so it moves smoothly; the time already gone is read once when
// it appears, so a ring that mounts late (a rejoin) starts at the right point.
function RadialDial({ endsAt, length, className = '' }) {
  const [elapsed] = useState(() => Math.max(0, Math.min(length, length - (endsAt - Date.now()))));

  if (!length) {
    return null;
  }

  return (
    <svg className={`radial-dial ${className}`.trim()} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle className="radial-dial-track" cx="18" cy="18" r="15" />
      <circle
        className="radial-dial-arc"
        cx="18"
        cy="18"
        r="15"
        style={{ animationDuration: `${length}ms`, animationDelay: `-${elapsed}ms` }}
      />
    </svg>
  );
}

// Where each token is drawn. It follows the real board position one tile at
// a time, so a token always walks the track, even when a snapshot from the
// host skips tiles (Relay sends the board a few times a second). Short moves
// forward or back are walked; anything longer, like Go to Jail, glides there.
const TRACK = 40;

function useWalkingPositions(positions, stepMs) {
  const [shown, setShown] = useState(positions);
  const lastMove = useRef(0);

  useEffect(() => {
    const next = { ...shown };
    let changed = false;
    let behind = 0;

    Object.keys(positions).forEach((id) => {
      const from = shown[id] ?? positions[id];
      const to = positions[id];

      if (from === to) {
        return;
      }

      const ahead = (to - from + TRACK) % TRACK;
      const back = (from - to + TRACK) % TRACK;

      if (ahead <= 12) {
        next[id] = (from + 1) % TRACK;
        behind = Math.max(behind, ahead);
      } else if (back <= 3) {
        next[id] = (from - 1 + TRACK) % TRACK;
        behind = Math.max(behind, back);
      } else {
        next[id] = to;
      }

      changed = true;
    });

    if (!changed) {
      return undefined;
    }

    // A little quicker than the host's own step, so it never falls behind,
    // and quicker still when it has a lot of catching up to do.
    const gap = behind > 6 ? Math.min(300, stepMs) : stepMs * 0.9;
    const wait = Math.max(0, gap - (Date.now() - lastMove.current));
    const timer = setTimeout(() => {
      lastMove.current = Date.now();
      setShown(next);
    }, wait);

    return () => clearTimeout(timer);
  }, [positions, shown, stepMs]);

  return shown;
}

// Tile centres inside the board, measured without transforms so a tile that
// lifts on hover never moves the tokens. Measured again whenever the board
// changes size.
function useTileCentres(boardRef, tileRefs) {
  const [centres, setCentres] = useState({});

  useLayoutEffect(() => {
    const board = boardRef.current;

    if (!board) {
      return undefined;
    }

    const measure = () => {
      const next = {};
      Object.entries(tileRefs.current).forEach(([id, tile]) => {
        if (tile) {
          next[id] = {
            x: tile.offsetLeft + tile.offsetWidth / 2,
            y: tile.offsetTop + tile.offsetHeight * 0.66,
            w: tile.offsetWidth,
          };
        }
      });
      setCentres(next);
    };

    measure();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [boardRef, tileRefs]);

  return centres;
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
}) {
  const isHost = !session || session.isHost;
  const [state, setState] = useState(() => {
    const cached = !isHost && session?.lastGame;
    return cached ? cached.state : resume || createInitialState(seatPlayers);
  });
  const [connection, setConnection] = useState('online');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [sheet, setSheet] = useState(null); // 'dice' | 'match' | 'end' | 'cards' | null
  const [cardsFor, setCardsFor] = useState(null);
  const [tradeDraft, setTradeDraft] = useState(null); // the offer being composed
  const [confirmBankrupt, setConfirmBankrupt] = useState(false);
  const [tradeChoices, setTradeChoices] = useState({}); // mortgage choices on an incoming offer
  const [hiddenTrades, setHiddenTrades] = useState([]); // incoming offers put aside for later
  const [showResults, setShowResults] = useState(true);
  const [goFlash, setGoFlash] = useState(false);
  const lastPositions = useRef(null);
  const goFlashTimer = useRef(null);
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
      onChange: (next) => {
        setState(next);
        session?.broadcastGame(next);

        // Saved between rolls, so a host who reloads can reopen the room.
        if ((!next.busy && next.turnPhase === 'pre-roll') || next.gameOver) {
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

      if (!player) {
        return;
      }

      switch (action.type) {
        case 'roll':
          engine.playTurn(player.id, { release: action.release });
          break;
        case 'purchase':
          engine.resolvePurchase(player.id, action.accept);
          break;
        case 'bid':
          engine.placeBid(player.id, action.amount);
          break;
        case 'manage':
          engine.manageProperty(player.id, Number(action.spaceId), action.action);
          break;
        case 'end-propose':
          engine.proposeEnd(player.id);
          break;
        case 'end-vote':
          engine.voteEnd(player.id, Boolean(action.agree));
          break;
        case 'end-turn':
          engine.endTurnEarly(player.id);
          break;
        case 'dismiss':
          engine.dismiss(player.id);
          break;
        case 'trade-propose':
          engine.proposeTrade(player.id, action.offer);
          break;
        case 'trade-respond':
          engine.respondTrade(player.id, action.tradeId, Boolean(action.accept), action.mortgageChoice);
          break;
        case 'trade-cancel':
          engine.cancelTrade(player.id, action.tradeId);
          break;
        case 'debt-bankrupt':
          engine.giveUpDebt(player.id);
          break;
        default:
          break;
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
      session.broadcastGame(engine.state);
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
      const engine = engineRef.current;

      if (!isHost) {
        session?.sendIntent(action);
        return;
      }

      if (!engine) return;

      switch (action.type) {
        case 'roll':
          engine.playTurn(myPlayerId, { release: action.release });
          break;
        case 'purchase':
          engine.resolvePurchase(myPlayerId, action.accept);
          break;
        case 'bid':
          engine.placeBid(myPlayerId, action.amount);
          break;
        case 'manage':
          engine.manageProperty(myPlayerId, action.spaceId, action.action);
          break;
        case 'end-propose':
          engine.proposeEnd(myPlayerId);
          break;
        case 'end-vote':
          engine.voteEnd(myPlayerId, Boolean(action.agree));
          break;
        case 'end-turn':
          engine.endTurnEarly(myPlayerId);
          break;
        case 'dismiss':
          engine.dismiss(myPlayerId);
          break;
        case 'trade-propose':
          engine.proposeTrade(myPlayerId, action.offer);
          break;
        case 'trade-respond':
          engine.respondTrade(myPlayerId, action.tradeId, Boolean(action.accept), action.mortgageChoice);
          break;
        case 'trade-cancel':
          engine.cancelTrade(myPlayerId, action.tradeId);
          break;
        case 'debt-bankrupt':
          engine.giveUpDebt(myPlayerId);
          break;
        default:
          break;
      }
    },
    [isHost, myPlayerId, session],
  );

  // -------------------------------------------------------------- sound

  // Every effect sound goes through this gate, so the sound effects switch
  // silences buying, express, coronation and winner sounds while the music
  // keeps its own switch.
  const effectsOn = audioSettings.effectsOn && audioSettings.effectsVolume > 0;
  const soundOnRef = useRef(effectsOn);
  const audioRef = useRef(null);

  if (!audioRef.current) {
    audioRef.current = Object.fromEntries(
      Object.entries(SOUND_FILES).map(([key, file]) => {
        const audio = new Audio(file);
        audio.preload = 'auto';
        return [key, audio];
      }),
    );
  }

  useEffect(() => {
    Object.values(audioRef.current).forEach((audio) => {
      audio.volume = Math.min(1, Math.max(0, audioSettings.effectsVolume));
    });
  }, [audioSettings.effectsVolume]);

  useEffect(() => {
    soundOnRef.current = effectsOn;

    if (!effectsOn) {
      Object.values(audioRef.current).forEach((audio) => audio.pause());
    }
  }, [effectsOn]);

  useEffect(() => {
    const audios = audioRef.current;
    return () => Object.values(audios).forEach((audio) => audio.pause());
  }, []);

  const lastSfx = useRef(state.sfx?.id ?? 0);

  useEffect(() => {
    const sfx = state.sfx;

    if (!sfx || sfx.id === lastSfx.current) {
      return;
    }

    lastSfx.current = sfx.id;

    if (!soundOnRef.current) {
      return;
    }

    const audio = audioRef.current[sfx.key];

    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }, [state.sfx]);

  // ------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setSelectedProperty(null);
        setSheet(null);
        setTradeDraft(null);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------ derived

  const players = state.players;
  const stepMs = testTiming().step || DEFAULT_TIMING.step;
  const shownPositions = useWalkingPositions(state.positions, stepMs);
  const boardRef = useRef(null);
  const tileRefs = useRef({});
  const tileCentres = useTileCentres(boardRef, tileRefs);

  // A token that wraps from the top row back past Go lights the Go tile up
  // for a moment. Going to Jail also moves a token back, so Jail is skipped.
  useEffect(() => {
    const before = lastPositions.current;
    lastPositions.current = shownPositions;

    const passed =
      before &&
      Object.keys(shownPositions).some(
        (id) => before[id] >= 28 && shownPositions[id] <= 11 && shownPositions[id] !== 10,
      );

    if (passed) {
      setGoFlash(true);
      clearTimeout(goFlashTimer.current);
      goFlashTimer.current = setTimeout(() => setGoFlash(false), 1400);
    }
  }, [shownPositions]);

  useEffect(() => () => clearTimeout(goFlashTimer.current), []);

  // Each new debt starts without the bankruptcy confirm open.
  useEffect(() => setConfirmBankrupt(false), [state.debt?.endsAt]);

  const activePlayer = players[state.activeIndex];
  const me = players.find((player) => player.id === myPlayerId);
  const amAlive = me && !state.bankrupt[me.id];
  const isMyTurn = activePlayer?.id === myPlayerId;
  const canRoll = isMyTurn && amAlive && !state.busy && !state.gameOver && state.turnPhase !== 'actions';
  const inActionWindow = isMyTurn && state.turnPhase === 'actions' && !state.gameOver;
  const rollAgain = isMyTurn && (state.doubles?.[myPlayerId] || 0) > 0 && !state.busy;
  // Ending by agreement: every person still playing votes, computers follow.
  const voters = players.filter((player) => player.kind === 'human' && !state.bankrupt[player.id]);
  const endVote = state.endVote;
  const iAmVoter = voters.some((player) => player.id === myPlayerId);
  const canProposeEnd = iAmVoter && !state.gameOver && !endVote;
  const waitingOn = endVote ? voters.filter((player) => !endVote.agreed.includes(player.id)) : [];
  const mustVote = endVote && !endVote.passed && iAmVoter && !endVote.agreed.includes(myPlayerId);
  const detainedFor = (id) => state.detained?.[id];
  const isDetained = (id) => detainedFor(id) !== null && detainedFor(id) !== undefined;
  const myDetention = isDetained(myPlayerId);

  // Districts where you could build right now, grouped by colour family.
  const buildable = useMemo(() => {
    if (!myPlayerId || state.gameOver) return [];
    const families = new Map();

    Object.keys(state.deeds).forEach((id) => {
      const space = BOARD_SPACES[id];
      if (
        state.deeds[id].owner === myPlayerId &&
        space.type === 'property' &&
        Estate.canBuild(state.deeds, id, BOARD_SPACES) &&
        !families.has(space.colorGroup)
      ) {
        families.set(space.colorGroup, Number(id));
      }
    });

    return [...families.entries()];
  }, [state.deeds, state.gameOver, myPlayerId]);

  const netWorths = useMemo(
    () =>
      Object.fromEntries(
        players.map((player) => [
          player.id,
          state.bankrupt[player.id] ? 0 : Estate.netWorth(player.id, state.balances, state.deeds, BOARD_SPACES),
        ]),
      ),
    [players, state.balances, state.deeds, state.bankrupt],
  );

  const localTime = (at) => (at ? at + (isHost ? 0 : clockOffset) : 0);
  const auctionLeft = useCountdown(localTime(state.auction?.endsAt));
  const actionLeft = useCountdown(localTime(state.turnPhase === 'actions' ? state.actionEndsAt : 0));
  const log = state.log || [];
  const myCode = me?.code;
  const canDevelopNow =
    isMyTurn && amAlive && !state.gameOver && ((state.turnPhase === 'pre-roll' && !state.busy) || state.turnPhase === 'actions');

  useEffect(() => {
    if (state.gameOver) {
      setShowResults(true);
    }
  }, [state.gameOver]);

  const ownerOf = (spaceId) => {
    const deed = state.deeds[spaceId];
    return deed ? players.find((player) => player.id === deed.owner) : null;
  };

  // --------------------------------------------------------------- render

  const renderPurchaseOffer = () => {
    const offer = state.purchaseOffer;

    if (!offer || offer.playerId !== myPlayerId) {
      return null;
    }

    const space = BOARD_SPACES[offer.spaceId];
    const balance = state.balances[myPlayerId];
    const canAfford = balance >= space.price;
    const accent = spaceAccent(space);

    return (
      <div className="drawn-card-overlay">
        <div className="property-card purchase-offer" role="dialog" aria-labelledby="purchase-offer-title">
          <header className="property-card-header">
            <div className="property-card-color-bar" style={{ background: accent }} />
            <p className="property-card-kicker">For sale</p>
            <h3 id="purchase-offer-title">{space.name}</h3>
          </header>

          <div className="property-card-body">
            <div className="property-card-row">
              <span>Price</span>
              <strong className={canAfford ? 'amount-positive' : 'amount-negative'}>{formatRupees(space.price)}</strong>
            </div>
            <div className="property-card-row">
              <span>Your balance</span>
              <span>{formatRupees(balance)}</span>
            </div>
            <div className="property-card-row">
              <span>{canAfford ? 'Balance after buying' : 'Shortfall'}</span>
              <span className={canAfford ? '' : 'amount-negative'}>{formatRupees(Math.abs(balance - space.price))}</span>
            </div>

            <p className="property-card-note">
              If you decline, {space.name} goes to auction and every player, you included, can bid for it
            </p>

            <div className="purchase-offer-actions">
              <GoldButton onClick={() => act({ type: 'purchase', accept: true })} disabled={!canAfford}>
                Buy property
              </GoldButton>
              <GoldButton variant="ghost" onClick={() => act({ type: 'purchase', accept: false })}>
                Decline
              </GoldButton>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAuction = () => {
    const auction = state.auction;

    if (!auction) {
      return null;
    }

    const space = BOARD_SPACES[auction.spaceId];
    const leader = players.find((player) => player.id === auction.highBidder);
    const myBalance = state.balances[myPlayerId] ?? 0;
    const minimum = auction.highBid === 0 ? AUCTION_MIN_BID : auction.highBid + AUCTION_INCREMENT;
    const iLead = auction.highBidder === myPlayerId;
    const seconds = Math.ceil(auctionLeft / 1000);
    const steps = [
      { label: `Bid ${formatCurrency(minimum)}`, amount: minimum },
      { label: '+ ₹50K', amount: Math.max(minimum, auction.highBid + 50000) },
      { label: '+ ₹1L', amount: Math.max(minimum, auction.highBid + 100000) },
    ];
    const accent = spaceAccent(space);

    return (
      <div className="drawn-card-overlay auction-overlay">
        <div className="property-card auction-sheet" role="dialog" aria-labelledby="auction-title">
          <header className="property-card-header">
            <div className="property-card-color-bar" style={{ background: accent }} />
            <p className="property-card-kicker">Auction · listed at {formatRupees(space.price)}</p>
            <h3 id="auction-title">{space.name}</h3>
            <span className={`auction-clock ${seconds <= 3 ? 'auction-clock--urgent' : ''}`} aria-live="polite">
              {seconds}s
            </span>
          </header>

          <RadialDial
            key={auction.endsAt}
            className="pop-dial"
            endsAt={localTime(auction.endsAt)}
            length={Math.max(1, localTime(auction.endsAt) - Date.now())}
          />

          <div className="property-card-body">
            <div className="auction-lead">
              <span>Highest bid</span>
              <strong key={auction.highBid} className="auction-amount">
                {auction.highBid ? formatRupees(auction.highBid) : 'No bids yet'}
              </strong>
              <span className="auction-leader">
                {leader ? `${leader.id === myPlayerId ? 'You lead' : `${leader.name} leads`}` : `Opening bid ${formatRupees(AUCTION_MIN_BID)}`}
              </span>
            </div>

            {auction.bids.length > 0 && (
              <ol className="auction-bids">
                {[...auction.bids].reverse().map((bid, index) => {
                  const bidder = players.find((player) => player.id === bid.playerId);
                  return (
                    <li key={`${bid.playerId}-${bid.amount}-${index}`}>
                      <span style={{ color: PIECES[bidder?.pieceKey]?.colour }}>{bidder?.name}</span>
                      <span>{formatRupees(bid.amount)}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {amAlive ? (
              <div className="auction-actions">
                {steps.map((step) => (
                  <button
                    key={step.label}
                    type="button"
                    className="auction-bid-button"
                    disabled={iLead || step.amount > myBalance || auctionLeft <= 0}
                    onClick={() => act({ type: 'bid', amount: step.amount })}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="property-card-note">You are watching this auction</p>
            )}

            <p className="auction-hint">
              {iLead
                ? 'You hold the top bid, hold your nerve'
                : `Your cash ${formatRupees(myBalance)} · late bids add a few seconds`}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderPropertyCard = () => {
    if (selectedProperty === null) {
      return null;
    }

    const space = BOARD_SPACES[selectedProperty];
    const details = propertyDetails[selectedProperty];
    const isRoute = space.type === 'route';
    const isUtility = space.type === 'utility';
    const deed = state.deeds[selectedProperty];
    const owner = ownerOf(selectedProperty);
    const accent = isRoute ? '#2f6170' : isUtility ? '#a46f17' : `var(--color-${space.colorGroup})`;
    const kicker = isRoute ? 'Express station' : isUtility ? 'Utility' : 'District';
    const mine = deed && deed.owner === myPlayerId && amAlive && !state.gameOver;
    const balance = state.balances[myPlayerId] ?? 0;

    return (
      <div className="property-card-overlay" onClick={() => setSelectedProperty(null)}>
        <div
          className="property-card"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-labelledby="property-card-title"
        >
          <header className="property-card-header">
            <div className="property-card-color-bar" style={{ background: accent }} />
            <p className="property-card-kicker">{kicker}</p>
            <h3 id="property-card-title">{space.name}</h3>
            <button
              type="button"
              className="property-card-close"
              onClick={() => setSelectedProperty(null)}
              aria-label="Close property details"
            >
              ✕
            </button>
          </header>

          <div className="property-card-body">
            <div className="property-card-row">
              <span>Owner</span>
              <strong>
                {owner ? `${owner.name}${deed.mortgaged ? ' · mortgaged' : ''}` : 'The bank'}
              </strong>
            </div>
            <div className="property-card-row">
              <span>Purchase price</span>
              <strong>{formatRupees(space.price)}</strong>
            </div>

            {isRoute && (
              <>
                <div className="property-card-section">
                  <h4>Rent by stations owned</h4>
                  {routeDetails.rent.map((rent, index) => (
                    <div className="property-card-row" key={rent}>
                      <span>{index + 1} station{index ? 's' : ''} owned</span>
                      <span>{formatRupees(rent)}</span>
                    </div>
                  ))}
                </div>
                <div className="property-card-section">
                  <div className="property-card-row">
                    <span>Mortgage value</span>
                    <span>{formatRupees(routeDetails.mortgage)}</span>
                  </div>
                </div>
                <p className="property-card-note">
                  Secunderabad, Vijayawada, Kacheguda and Tirupati share this schedule, and rent rises with
                  how many stations one owner holds
                </p>
              </>
            )}

            {isUtility && (
              <>
                <div className="property-card-section">
                  <h4>Rent by dice roll</h4>
                  <div className="property-card-row">
                    <span>Owning one utility</span>
                    <span>{utilityDetails.multipliers[0]} × dice roll × {formatRupees(utilityDetails.perPip)}</span>
                  </div>
                  <div className="property-card-row">
                    <span>Owning both utilities</span>
                    <strong>{utilityDetails.multipliers[1]} × dice roll × {formatRupees(utilityDetails.perPip)}</strong>
                  </div>
                </div>
                <div className="property-card-section">
                  <div className="property-card-row">
                    <span>Mortgage value</span>
                    <span>{formatRupees(utilityDetails.mortgage)}</span>
                  </div>
                </div>
              </>
            )}

            {details && (
              <>
                <div className="property-card-section">
                  <h4>Rent schedule</h4>
                  {['Base rent', 'With 1 house', 'With 2 houses', 'With 3 houses', 'With 4 houses', 'With a hotel'].map(
                    (label, index) => (
                      <div className="property-card-row" key={label}>
                        <span>{label}</span>
                        <span>{formatRupees(details.rent[index])}</span>
                      </div>
                    ),
                  )}
                </div>
                <div className="property-card-section">
                  <div className="property-card-row">
                    <span>House cost</span>
                    <span>{formatRupees(details.houseCost)}</span>
                  </div>
                  <div className="property-card-row">
                    <span>Mortgage value</span>
                    <span>{formatRupees(details.mortgage)}</span>
                  </div>
                </div>
                <p className="property-card-note">
                  Own every district in this colour family to build, houses go up evenly across the
                  family before a hotel, and base rent doubles once the family is complete
                </p>
              </>
            )}
          </div>

          {mine && !canDevelopNow && (
            <p className="property-card-note property-card-note--timing">
              Build and lift mortgages on your turn, before you roll or in the {Math.round(DEFAULT_TIMING.actionWindow / 1000)} seconds
              after your move, selling and mortgaging are open any time
            </p>
          )}

          {mine && (
            <div className="property-card-actions">
              {!deed.mortgaged && details && (
                <>
                  <button
                    type="button"
                    className="property-action-btn"
                    disabled={
                      !canDevelopNow || !Estate.canBuild(state.deeds, selectedProperty, BOARD_SPACES) || balance < details.houseCost
                    }
                    title="Own the full colour family and build evenly first, on your turn"
                    onClick={() => act({ type: 'manage', spaceId: selectedProperty, action: 'build' })}
                  >
                    Build {deed.houses === 4 ? 'hotel' : 'house'} ({formatRupees(details.houseCost)})
                  </button>
                  <button
                    type="button"
                    className="property-action-btn"
                    disabled={!Estate.canSellBuilding(state.deeds, selectedProperty, BOARD_SPACES)}
                    onClick={() => act({ type: 'manage', spaceId: selectedProperty, action: 'sell' })}
                  >
                    Sell building ({formatRupees(details.houseCost / 2)})
                  </button>
                </>
              )}
              {!deed.mortgaged && (
                <button
                  type="button"
                  className="property-action-btn"
                  disabled={!Estate.canMortgage(state.deeds, selectedProperty, BOARD_SPACES)}
                  title="Sell the buildings in this family before mortgaging"
                  onClick={() => act({ type: 'manage', spaceId: selectedProperty, action: 'mortgage' })}
                >
                  Mortgage ({formatRupees(Estate.mortgageValue(selectedProperty, BOARD_SPACES))})
                </button>
              )}
              {deed.mortgaged && (
                <button
                  type="button"
                  className="property-action-btn"
                  disabled={!canDevelopNow || balance < liftCost(deed, selectedProperty)}
                  title={deed.interestPaid ? 'The 10% fee was paid when you traded for it' : 'Includes 10% interest'}
                  onClick={() => act({ type: 'manage', spaceId: selectedProperty, action: 'unmortgage' })}
                >
                  Unmortgage ({formatRupees(liftCost(deed, selectedProperty))})
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderResults = () => {
    const over = state.gameOver;

    if (!over || !showResults) {
      return null;
    }

    const winners = over.winners.map((id) => players.find((player) => player.id === id)).filter(Boolean);
    const iWon = over.winners.includes(myPlayerId);
    const headline = winners.length > 1
      ? `${winners.map((player) => player.name).join(' and ')} share the crown`
      : iWon
        ? 'You win the crown'
        : `${winners[0]?.name} wins the crown`;

    return (
      <div className="property-card-overlay results-overlay">
        <div className="property-card results-sheet" role="dialog" aria-labelledby="results-title">
          <div className="results-hero">
            <span className="results-crown" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 17h16M5 17 3.5 8l5 3.5L12 5l3.5 6.5 5-3.5L19 17M6 20h12" />
              </svg>
            </span>
            <p className="property-card-kicker">
              {over.reason === 'bankruptcy'
                ? 'Last player standing'
                : over.reason === 'agreed'
                  ? `Ended by agreement after ${over.turns ?? state.turnCount} turns`
                  : `Match complete after ${TOTAL_MATCH_TURNS} turns`}
            </p>
            <h3 id="results-title">{headline}</h3>
            <p className="results-sub">Ranked by total net worth, cash plus the value of every property held</p>
          </div>

          <ol className="results-table">
            {over.standings.map((entry, index) => {
              const isWinner = over.winners.includes(entry.id);
              return (
                <li
                  key={entry.id}
                  className={`results-row ${isWinner ? 'results-row--winner' : ''}`}
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
                      {entry.bankrupt
                        ? 'Bankrupt'
                        : `Cash ${formatRupees(entry.cash)} · Property ${formatRupees(entry.propertyValue)} · ${entry.deeds} deed${entry.deeds === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className="results-worth">
                    <span>Net worth</span>
                    <strong>{formatRupees(entry.netWorth)}</strong>
                  </span>
                </li>
              );
            })}
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

  const offer = state.purchaseOffer;
  const deciding = offer && offer.playerId !== myPlayerId ? players.find((player) => player.id === offer.playerId) : null;

  // A rent, tax, fine or Go pop up. The money moves only when it closes.
  const renderNotice = () => {
    const notice = state.notice;

    if (!notice) {
      return null;
    }

    const payer = players.find((player) => player.id === notice.playerId);
    const gain = notice.amount > 0;
    const canClose = notice.playerId === myPlayerId && isMyTurn;

    return (
      <div className="drawn-card-overlay">
        <div className={`drawn-card notice-card notice-card--${notice.kind}`} role="status" aria-live="polite" key={notice.id}>
          <span className="drawn-card-deck">{notice.title}</span>
          <div className="drawn-card-rule" />
          <strong className={`notice-amount ${gain ? 'amount-positive' : 'amount-negative'}`}>
            {gain ? '+' : '−'}
            {formatRupees(Math.abs(notice.amount))}
          </strong>
          <p className="drawn-card-text">{notice.text}</p>
          <span className="drawn-card-holder">
            {notice.playerId === myPlayerId ? 'Your balance' : `${payer?.name}'s balance`} updates when this closes
          </span>
          <RadialDial key={notice.id} className="pop-dial" endsAt={localTime(notice.endsAt)} length={notice.length} />
          {canClose && (
            <button type="button" className="text-link hold-close" onClick={() => act({ type: 'dismiss' })}>
              {gain ? 'Collect now' : 'Pay now'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderDrawnCard = () => {
    const card = state.drawnCard;

    if (!card) {
      return null;
    }

    return (
      <div className="drawn-card-overlay">
        <div className="drawn-card" role="status" aria-live="polite">
          <span className="drawn-card-deck">{card.deckName}</span>
          <div className="drawn-card-rule" />
          <p className="drawn-card-text">{card.text}</p>
          <span className="drawn-card-holder">Drawn by {card.playerId === myPlayerId ? 'you' : card.playerName}</span>
          <RadialDial key={card.endsAt} className="pop-dial" endsAt={localTime(card.endsAt)} length={card.length} />
          {card.playerId === myPlayerId && isMyTurn && (
            <button type="button" className="text-link hold-close" onClick={() => act({ type: 'dismiss' })}>
              Got it
            </button>
          )}
        </div>
      </div>
    );
  };

  // Everyone's title deeds, open to the whole table.
  // ------------------------------------------------------------ trading

  const trades = state.trades || [];
  const nameOf = (id) => players.find((player) => player.id === id)?.name || 'A player';
  const tradePartners = players.filter((player) => player.id !== myPlayerId && !state.bankrupt[player.id]);
  const canTrade = Boolean(me) && amAlive && !state.gameOver && tradePartners.length > 0;
  const myOffers = trades.filter((trade) => trade.from === myPlayerId);
  const offersToMe = trades.filter((trade) => trade.to === myPlayerId);
  const incoming = offersToMe.find((trade) => !hiddenTrades.includes(trade.id));
  const blankSide = () => ({ cash: 0, deeds: [], pardons: 0 });
  const deedsOf = (id) =>
    Object.keys(state.deeds)
      .map(Number)
      .filter((spaceId) => state.deeds[spaceId].owner === id)
      .sort((a, b) => a - b);

  const openTrade = (to, preset = {}) => {
    setSheet(null);
    setTradeDraft({
      to: to || tradePartners[0]?.id,
      give: blankSide(),
      get: blankSide(),
      mortgageChoice: {},
      ...preset,
    });
  };

  const describeSide = (side) => {
    const parts = [
      ...side.deeds.map((id) => BOARD_SPACES[id].name),
      side.cash > 0 ? formatRupees(side.cash) : null,
      side.pardons > 0 ? 'Get Out of Jail Free card' : null,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Nothing yet';
  };

  // One side of a deal: deeds to tick, cash to add and a Jail Free card.
  const renderTradeSide = (key, ownerId, title) => {
    const side = tradeDraft[key];
    const owned = deedsOf(ownerId);
    const cashLimit = state.balances[ownerId] || 0;
    const pardonsHeld = state.pardons[ownerId] || 0;
    const update = (patch) => setTradeDraft((draft) => ({ ...draft, [key]: { ...draft[key], ...patch } }));
    const setCash = (value) => update({ cash: Math.max(0, Math.min(cashLimit, Math.floor(value) || 0)) });

    return (
      <div className="trade-side">
        <h4>{title}</h4>

        {owned.length === 0 ? (
          <p className="trade-empty">No properties</p>
        ) : (
          <ul className="trade-deeds">
            {owned.map((id) => {
              const space = BOARD_SPACES[id];
              const deed = state.deeds[id];
              const locked = familyHasBuildings(state.deeds, id);
              const picked = side.deeds.includes(id);

              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`trade-deed ${picked ? 'trade-deed--picked' : ''}`}
                    style={{ '--deed': spaceAccent(space) }}
                    disabled={locked}
                    aria-pressed={picked}
                    onClick={() =>
                      update({ deeds: picked ? side.deeds.filter((entry) => entry !== id) : [...side.deeds, id] })
                    }
                  >
                    <span className="trade-deed-band" aria-hidden="true" />
                    <strong>{space.name}</strong>
                    <span>
                      {locked ? 'Sell buildings first' : deed.mortgaged ? 'Mortgaged' : formatRupees(space.price)}
                    </span>
                    <i className="trade-deed-check" aria-hidden="true">
                      ✓
                    </i>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <label className="trade-cash">
          <span>Cash</span>
          <input
            type="number"
            min="0"
            step="10000"
            max={cashLimit}
            inputMode="numeric"
            value={side.cash || ''}
            placeholder="₹0"
            onChange={(event) => setCash(Number(event.target.value))}
            aria-label={`${title} cash`}
          />
        </label>
        <div className="trade-cash-steps">
          {[10000, 50000, 100000].map((step) => (
            <button key={step} type="button" onClick={() => setCash(side.cash + step)} disabled={side.cash + step > cashLimit}>
              + {formatCurrency(step)}
            </button>
          ))}
          {side.cash > 0 && (
            <button type="button" onClick={() => setCash(0)}>
              Clear
            </button>
          )}
        </div>
        <p className="trade-limit">Up to {formatRupees(cashLimit)}</p>

        {pardonsHeld > 0 && (
          <button
            type="button"
            className={`trade-pardon ${side.pardons ? 'trade-pardon--picked' : ''}`}
            aria-pressed={side.pardons > 0}
            onClick={() => update({ pardons: side.pardons ? 0 : 1 })}
          >
            ⚖ Get Out of Jail Free card
          </button>
        )}
      </div>
    );
  };

  const renderMortgageChoices = (ids, choices, onChoose) => {
    const mortgaged = ids.filter((id) => state.deeds[id]?.mortgaged);

    if (mortgaged.length === 0) {
      return null;
    }

    return (
      <div className="trade-mortgages">
        <h4>Mortgaged properties you receive</h4>
        {mortgaged.map((id) => (
          <div className="trade-mortgage" key={id}>
            <span>{BOARD_SPACES[id].name}</span>
            <div role="radiogroup" aria-label={`${BOARD_SPACES[id].name} mortgage`}>
              {['interest', 'lift'].map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={(choices[id] || 'interest') === choice}
                  className={(choices[id] || 'interest') === choice ? 'is-picked' : ''}
                  onClick={() => onChoose(id, choice)}
                >
                  {choice === 'interest' ? 'Pay 10% now' : 'Lift mortgage'} {formatRupees(mortgageFee(id, choice))}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="trade-note">
          Paying 10% keeps it mortgaged, lifting it later then costs just the mortgage value
        </p>
      </div>
    );
  };

  const renderTradeComposer = () => {
    if (!tradeDraft || !canTrade) {
      return null;
    }

    const partner = players.find((player) => player.id === tradeDraft.to) || tradePartners[0];
    const trade = { from: myPlayerId, to: partner.id, give: tradeDraft.give, get: tradeDraft.get };
    const problem = tradeProblem(state, trade, tradeDraft.mortgageChoice);
    const untouched =
      !trade.give.deeds.length && !trade.get.deeds.length && !trade.give.cash && !trade.get.cash && !trade.give.pardons && !trade.get.pardons;

    return (
      <div className="property-card-overlay end-overlay" onClick={() => setTradeDraft(null)}>
        <div className="property-card trade-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="trade-title">
          <header className="property-card-header">
            <p className="property-card-kicker">Propose a deal</p>
            <h3 id="trade-title">Trade with {partner.name}</h3>
            <button type="button" className="property-card-close" onClick={() => setTradeDraft(null)} aria-label="Close">
              ✕
            </button>
          </header>

          {tradePartners.length > 1 && (
            <div className="cards-tabs" role="tablist">
              {tradePartners.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  role="tab"
                  aria-selected={player.id === partner.id}
                  className={`cards-tab seat-${player.pieceKey} ${player.id === partner.id ? 'cards-tab--active' : ''}`}
                  onClick={() => setTradeDraft((draft) => ({ ...draft, to: player.id, get: blankSide(), mortgageChoice: {} }))}
                >
                  <PieceMark piece={player.pieceKey} variant="token" />
                  <span>{player.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="property-card-body">
            <div className="trade-columns">
              {renderTradeSide('give', myPlayerId, 'You give')}
              <span className="trade-swap" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 8h14l-4-4M20 16H6l4 4" />
                </svg>
              </span>
              {renderTradeSide('get', partner.id, `You ask ${partner.name} for`)}
            </div>

            {renderMortgageChoices(tradeDraft.get.deeds, tradeDraft.mortgageChoice, (id, choice) =>
              setTradeDraft((draft) => ({ ...draft, mortgageChoice: { ...draft.mortgageChoice, [id]: choice } })),
            )}

            <div className="trade-summary">
              <p>
                <span>You give</span> {describeSide(trade.give)}
              </p>
              <p>
                <span>You get</span> {describeSide(trade.get)}
              </p>
            </div>

            {problem && !untouched && <p className="trade-problem">{problem}</p>}

            <div className="purchase-offer-actions">
              <GoldButton
                disabled={Boolean(problem)}
                onClick={() => {
                  act({ type: 'trade-propose', offer: { ...trade, mortgageChoice: tradeDraft.mortgageChoice } });
                  setTradeDraft(null);
                }}
              >
                Send offer
              </GoldButton>
              <GoldButton variant="ghost" onClick={() => setTradeDraft(null)}>
                Cancel
              </GoldButton>
            </div>
            <p className="trade-note">
              Both players must agree, buildings cannot be traded, and gifts or loans are not allowed
            </p>
          </div>
        </div>
      </div>
    );
  };

  // A payment bigger than this player's cash: they choose which buildings to
  // sell and which properties to mortgage, in any order, before the clock
  // runs out and the rest is sold for them.
  const renderDebt = () => {
    const debt = state.debt;

    if (!debt || debt.playerId !== myPlayerId || state.gameOver) {
      return null;
    }

    const balance = state.balances[myPlayerId];
    const short = Math.max(0, debt.amount - balance);
    const creditor = players.find((player) => player.id === debt.creditorId);
    const mine = Object.keys(state.deeds)
      .map(Number)
      .filter((id) => state.deeds[id].owner === myPlayerId)
      .sort((a, b) => a - b);
    const hasBuildings = (id) => state.deeds[id].houses > 0 || state.deeds[id].hotel;
    const built = mine.filter(hasBuildings);
    const plain = mine.filter((id) => !hasBuildings(id) && !state.deeds[id].mortgaged);
    const sell = (id) => act({ type: 'manage', spaceId: id, action: 'sell' });
    const mortgage = (id) => act({ type: 'manage', spaceId: id, action: 'mortgage' });

    return (
      <div className="property-card-overlay end-overlay">
        <div className="property-card debt-sheet" role="dialog" aria-labelledby="debt-title">
          <RadialDial key={debt.endsAt} className="pop-dial" endsAt={localTime(debt.endsAt)} length={debt.length} />
          <header className="property-card-header">
            <p className="property-card-kicker">Raise funds</p>
            <h3 id="debt-title">
              {formatRupees(debt.amount)} for {debt.reason}
              {creditor ? ` to ${creditor.name}` : ''}
            </h3>
          </header>

          <div className="property-card-body">
            <div className="debt-progress">
              <span>
                Cash <strong>{formatRupees(balance)}</strong>
              </span>
              <span className={short ? 'amount-negative' : 'amount-positive'}>
                {short ? `${formatRupees(short)} still to raise` : 'Covered'}
              </span>
            </div>
            <p className="debt-help">
              Choose what goes first, sell houses and hotels for half their cost or mortgage any property for half its
              price, the payment goes through as soon as your cash covers it
            </p>

            {built.length > 0 && (
              <section className="debt-group">
                <h4>Buildings</h4>
                <ul>
                  {built.map((id) => {
                    const deed = state.deeds[id];
                    const canSell = Estate.canSellBuilding(state.deeds, id, BOARD_SPACES);
                    const refund = Estate.propertyDetails[id].houseCost / 2;
                    return (
                      <li key={id} style={{ '--family': `var(--color-${BOARD_SPACES[id].colorGroup})` }}>
                        <span className="debt-name">
                          <strong>{BOARD_SPACES[id].name}</strong>
                          <em>{deed.hotel ? 'Hotel' : `${deed.houses} house${deed.houses > 1 ? 's' : ''}`}</em>
                        </span>
                        <button type="button" className="debt-action" disabled={!canSell} onClick={() => sell(id)}>
                          {canSell
                            ? `Sell ${deed.hotel ? 'the hotel' : 'a house'} ${formatRupees(refund)}`
                            : 'Sell evenly, fullest first'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {plain.length > 0 && (
              <section className="debt-group">
                <h4>Properties</h4>
                <ul>
                  {plain.map((id) => {
                    const canMortgage = Estate.canMortgage(state.deeds, id, BOARD_SPACES);
                    const family = BOARD_SPACES[id].colorGroup;
                    return (
                      <li key={id} style={family ? { '--family': `var(--color-${family})` } : undefined}>
                        <span className="debt-name">
                          <strong>{BOARD_SPACES[id].name}</strong>
                        </span>
                        <button type="button" className="debt-action" disabled={!canMortgage} onClick={() => mortgage(id)}>
                          {canMortgage
                            ? `Mortgage ${formatRupees(Estate.mortgageValue(id, BOARD_SPACES))}`
                            : "Sell this family's buildings first"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div className="debt-footer">
              {confirmBankrupt ? (
                <>
                  <span>Everything you own goes to {creditor ? creditor.name : 'the bank'}</span>
                  <button type="button" className="debt-bankrupt" onClick={() => act({ type: 'debt-bankrupt' })}>
                    Yes, declare bankruptcy
                  </button>
                  <button type="button" className="text-link" onClick={() => setConfirmBankrupt(false)}>
                    Keep playing
                  </button>
                </>
              ) : (
                <>
                  <span>When the time runs out, the rest is sold for you</span>
                  <button type="button" className="debt-bankrupt" onClick={() => setConfirmBankrupt(true)}>
                    Declare bankruptcy
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderIncomingTrade = () => {
    if (!incoming || tradeDraft || state.gameOver || state.debt?.playerId === myPlayerId) {
      return null;
    }

    const choices = tradeChoices[incoming.id] || {};
    const problem = tradeProblem(state, incoming, { ...incoming.mortgageChoice, ...choices });
    const proposer = players.find((player) => player.id === incoming.from);

    return (
      <div className="property-card-overlay end-overlay">
        <div className="property-card trade-sheet trade-sheet--incoming" role="dialog" aria-labelledby="trade-offer-title">
          <header className="property-card-header">
            <p className="property-card-kicker">Trade offer</p>
            <h3 id="trade-offer-title">{proposer?.name} wants to trade</h3>
          </header>
          <div className="property-card-body">
            <div className="trade-summary trade-summary--large">
              <p>
                <span>You receive</span> {describeSide(incoming.give)}
              </p>
              <p>
                <span>You give</span> {describeSide(incoming.get)}
              </p>
            </div>

            {renderMortgageChoices(incoming.give.deeds, choices, (id, choice) =>
              setTradeChoices((all) => ({ ...all, [incoming.id]: { ...choices, [id]: choice } })),
            )}

            {problem && <p className="trade-problem">{problem}</p>}

            <div className="purchase-offer-actions">
              <GoldButton
                disabled={Boolean(problem)}
                onClick={() => act({ type: 'trade-respond', tradeId: incoming.id, accept: true, mortgageChoice: choices })}
              >
                Accept
              </GoldButton>
              <GoldButton variant="ghost" onClick={() => act({ type: 'trade-respond', tradeId: incoming.id, accept: false })}>
                Decline
              </GoldButton>
            </div>
            <div className="trade-incoming-links">
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  act({ type: 'trade-respond', tradeId: incoming.id, accept: false });
                  openTrade(incoming.from, { give: { ...incoming.get }, get: { ...incoming.give } });
                }}
              >
                Counter offer
              </button>
              <button type="button" className="text-link" onClick={() => setHiddenTrades((list) => [...list, incoming.id])}>
                Decide later
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderCardViewer = () => {
    if (sheet !== 'cards') {
      return null;
    }

    const shown = players.find((player) => player.id === cardsFor) || players[0];
    const held = Object.keys(state.deeds)
      .map(Number)
      .filter((id) => state.deeds[id].owner === shown.id)
      .sort((a, b) => a - b);

    return (
      <div className="property-card-overlay" onClick={() => setSheet(null)}>
        <div
          className="property-card cards-sheet"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-labelledby="cards-title"
        >
          <header className="property-card-header">
            <p className="property-card-kicker">Title deeds</p>
            <h3 id="cards-title">Everyone's cards</h3>
            <button type="button" className="property-card-close" onClick={() => setSheet(null)} aria-label="Close">
              ✕
            </button>
          </header>

          <div className="cards-tabs" role="tablist">
            {players.map((player) => {
              const count = Object.values(state.deeds).filter((deed) => deed.owner === player.id).length;
              return (
                <button
                  key={player.id}
                  type="button"
                  role="tab"
                  aria-selected={player.id === shown.id}
                  className={`cards-tab seat-${player.pieceKey} ${player.id === shown.id ? 'cards-tab--active' : ''}`}
                  onClick={() => setCardsFor(player.id)}
                >
                  <PieceMark piece={player.pieceKey} variant="token" />
                  <span>{player.id === myPlayerId ? 'You' : player.name}</span>
                  <em>{count}</em>
                </button>
              );
            })}
          </div>

          <div className="property-card-body">
            <div className="cards-summary">
              <span>Cash {formatRupees(state.balances[shown.id] || 0)}</span>
              <span>Net worth {formatRupees(netWorths[shown.id] || 0)}</span>
              {state.pardons[shown.id] > 0 && <span>{state.pardons[shown.id]} Get Out of Jail Free</span>}
            </div>

            {held.length === 0 ? (
              <p className="cards-empty">{shown.id === myPlayerId ? 'You hold' : `${shown.name} holds`} no title deeds yet</p>
            ) : (
              <ul className="cards-grid">
                {held.map((id, index) => {
                  const space = BOARD_SPACES[id];
                  const deed = state.deeds[id];
                  return (
                    <li key={id} style={{ '--reveal-delay': `${index * 0.04}s` }}>
                      <button
                        type="button"
                        className={`deed-mini ${deed.mortgaged ? 'deed-mini--mortgaged' : ''}`}
                        style={{ '--deed': spaceAccent(space) }}
                        onClick={() => {
                          setSheet(null);
                          setSelectedProperty(id);
                        }}
                      >
                        <span className="deed-mini-band">
                          {space.art && <TileArt kind={space.art} />}
                        </span>
                        <strong>{space.name}</strong>
                        <span>
                          {deed.mortgaged
                            ? 'Mortgaged'
                            : deed.hotel
                              ? 'Hotel'
                              : deed.houses
                                ? `${deed.houses} house${deed.houses > 1 ? 's' : ''}`
                                : formatRupees(space.price)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  };

  const copyMyId = async () => {
    try {
      await navigator.clipboard.writeText(myCode);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 2000);
    } catch {
      setCopiedId(false);
    }
  };

  const actionSeconds = Math.ceil(actionLeft / 1000);
  const actionShare = state.actionLength ? Math.min(1, actionLeft / state.actionLength) : 0;

  return (
    <main className="board-game-page">
      <header className="board-topbar">
        <button className="lobby-brand" type="button" onClick={onExit} aria-label="Leave the game">
          <BrandLogo size={22} />
        </button>

        <div className="round-indicator">
          <span>Turn</span>
          <strong>{state.turnCount.toString().padStart(3, '0')}</strong>
          <span>of {TOTAL_MATCH_TURNS}</span>
          <button
            type="button"
            className="match-info-button"
            onClick={() => setSheet('match')}
            aria-label="How the match works"
            title="How the match works"
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

      <section className="board-game-layout">
        <aside className="board-side">
          <section className="player-panel" aria-label="Players">
            <p className="eyebrow">The table</p>

            <div className="player-list">
              {players.map((player, index) => {
                const bankrupt = state.bankrupt[player.id];
                return (
                  <article
                    className={`game-player seat-${player.pieceKey} ${index === state.activeIndex && !state.gameOver ? 'game-player--active' : ''} ${bankrupt ? 'game-player--bankrupt' : ''} ${player.away ? 'game-player--away' : ''}`}
                    key={player.id}
                  >
                    <span className="game-player-token">
                      <PieceMark piece={player.pieceKey} variant="token" title={player.name} />
                    </span>

                    <div>
                      <strong>
                        {player.name}
                        {player.id === myPlayerId && <em className="you-chip">You</em>}
                      </strong>
                      <span>
                        {bankrupt
                          ? 'Bankrupt'
                          : isDetained(player.id)
                            ? `In Jail, attempt ${detainedFor(player.id) + 1} of ${DETENTION_MAX_ATTEMPTS}`
                            : index === state.activeIndex && !state.gameOver
                              ? player.away
                                ? 'Away, the computer is playing'
                                : 'Taking a turn'
                              : kindLabel(player)}
                      </span>
                      {state.pardons[player.id] > 0 && (
                        <span className="player-pardons" title="Get Out of Jail Free">
                          ⚖ {state.pardons[player.id]} pardon{state.pardons[player.id] > 1 ? 's' : ''} held
                        </span>
                      )}
                    </div>

                    <AnimatedBalance value={state.balances[player.id]} className="game-player-balance" />
                    <span className="game-player-worth">Net worth {formatRupees(netWorths[player.id])}</span>
                    {canTrade && player.id !== myPlayerId && !bankrupt && (
                      <button type="button" className="game-player-trade" onClick={() => openTrade(player.id)}>
                        Trade
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {session && <ChatPanel session={session} compact />}

          <section className="activity-log" aria-label="Activity log">
            <p className="eyebrow">Activity</p>
            {log.length === 0 ? (
              <p className="activity-empty">{state.activity}</p>
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

        <section className="game-board-area" aria-label="Manapally game board">
          <div className="game-board" ref={boardRef}>
            {BOARD_SPACES.map((space) => {
              const [column, row] = BOARD_GRID[space.id];
              const isClickable = ['property', 'route', 'utility'].includes(space.type);
              const deed = state.deeds[space.id];
              const owner = deed ? ownerOf(space.id) : null;

              return (
                <article
                  className={`board-space ${getSpaceClass(space)} ${isClickable ? 'board-space--clickable' : ''} ${
                    selectedProperty === space.id ? 'board-space--selected' : ''
                  } ${owner ? 'board-space--owned' : ''} ${space.art ? 'board-space--art' : ''} ${
                    goFlash && space.id === 0 ? 'board-space--go-flash' : ''
                  }`}
                  key={space.id}
                  ref={(tile) => {
                    tileRefs.current[space.id] = tile;
                  }}
                  style={{ gridColumn: column, gridRow: row }}
                  onClick={() => isClickable && setSelectedProperty(space.id)}
                  onKeyDown={(event) => {
                    if (isClickable && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      setSelectedProperty(space.id);
                    }
                  }}
                  tabIndex={isClickable ? 0 : -1}
                  role={isClickable ? 'button' : undefined}
                  aria-label={
                    isClickable
                      ? `${space.name}, ${owner ? `owned by ${owner.name}` : `for sale at ${formatRupees(space.price)}`}`
                      : space.taxLabel
                        ? `${space.name}, ${space.taxLabel}`
                        : space.name
                  }
                >
                  <span className={`space-name ${nameFit(space)}`}>
                    {space.name}
                    {space.subname && <small>{space.subname}</small>}
                  </span>

                  {space.art && <TileArt kind={space.art} className="space-art" />}

                  {space.taxLabel && (
                    <span className="space-cost space-cost--tax">
                      Pay <b>{formatRupees(TAXES[space.id])}</b>
                    </span>
                  )}

                  {/* Owned spaces swap the price label for a solid owner badge */}
                  {owner ? (
                    <span
                      className={`space-owner seat-${owner.pieceKey} ${deed.mortgaged ? 'space-owner--mortgaged' : ''}`}
                      title={`Owned by ${owner.name}${deed.mortgaged ? ', mortgaged' : ''}`}
                    >
                      <PieceMark piece={owner.pieceKey} variant="token" />
                      <span>{deed.mortgaged ? 'Mortgaged' : owner.id === myPlayerId ? 'Yours' : owner.name}</span>
                      {(deed.houses > 0 || deed.hotel) && (
                        <b
                          className={`space-builds ${deed.hotel ? 'space-builds--hotel' : ''}`}
                          aria-label={deed.hotel ? 'Hotel' : `${deed.houses} house${deed.houses > 1 ? 's' : ''}`}
                        >
                          <svg viewBox="0 0 12 12" aria-hidden="true">
                            {deed.hotel ? (
                              <path d="M2 11V3.5L6 1l4 2.5V11H7.5V8.5h-3V11z" />
                            ) : (
                              <path d="M1.5 6 6 2l4.5 4H9.5v5h-7V6z" />
                            )}
                          </svg>
                          {deed.hotel ? 'H' : deed.houses}
                        </b>
                      )}
                    </span>
                  ) : (
                    space.price && <span className="space-cost">{formatCurrency(space.price)}</span>
                  )}

                </article>
              );
            })}

            {/* Tokens ride above the tiles and glide from one to the next */}
            <div className="token-layer" aria-hidden="true">
              {players.map((player) => {
                if (state.bankrupt[player.id]) return null;
                const position = shownPositions[player.id];
                const centre = tileCentres[position];
                if (!centre) return null;

                const sharing = players.filter(
                  (other) => !state.bankrupt[other.id] && shownPositions[other.id] === position,
                );
                const index = sharing.indexOf(player);
                const spread = Math.min(centre.w * 0.28, 14);
                const dx = (index - (sharing.length - 1) / 2) * spread;
                const waiting =
                  player.id === activePlayer?.id && state.turnPhase === 'pre-roll' && !state.busy && !state.gameOver;

                return (
                  <span
                    className="token-slot"
                    key={player.id}
                    style={{
                      transform: `translate(${centre.x + dx}px, ${centre.y}px)`,
                      transitionDuration: `${Math.round(stepMs * 0.85)}ms`,
                      '--step': `${Math.round(stepMs * 0.85)}ms`,
                      zIndex: 2 + index,
                    }}
                  >
                    <span
                      key={position}
                      className={`board-token seat-${player.pieceKey} ${waiting ? 'board-token--waiting' : ''}`}
                      title={player.name}
                    >
                      <PieceMark piece={player.pieceKey} variant="token" title={player.name} />
                    </span>
                  </span>
                );
              })}
            </div>

            <div className="board-direction-indicator" aria-label="Movement direction is clockwise">
              <svg viewBox="0 0 100 100" className="direction-arrow">
                <path d="M 50 10 A 40 40 0 1 1 10 50" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
                <polygon points="8,50 14,54 14,46" fill="currentColor" />
              </svg>
            </div>

            <div className="board-centre-art">
              <BrandMark size={64} className="centre-crown" />
              <h1>Manapally</h1>
              <p>Andhra Pradesh and Telangana edition</p>
              <div className="centre-divider" />
              <span className="centre-message">
                Pass Go
                <br />
                to receive {formatCurrency(START_REWARD)}
              </span>
              {deciding && (
                <span className="centre-status">
                  {deciding.name} is deciding on {BOARD_SPACES[offer.spaceId].name}
                </span>
              )}
            </div>
          </div>

          {renderDrawnCard()}
          {renderNotice()}
          {renderPurchaseOffer()}
          {renderAuction()}
          {renderPropertyCard()}
          {renderCardViewer()}
          {renderTradeComposer()}
          {renderIncomingTrade()}
          {renderDebt()}
          {renderResults()}

          {sheet === 'dice' && (
            <div className="property-card-overlay" onClick={() => setSheet(null)}>
              <div className="property-card dice-info-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="dice-info-title">
                <header className="property-card-header">
                  <p className="property-card-kicker">Fair play</p>
                  <h3 id="dice-info-title">How the dice work</h3>
                  <button type="button" className="property-card-close" onClick={() => setSheet(null)} aria-label="Close dice information">
                    ✕
                  </button>
                </header>
                <div className="property-card-body dice-info-body">
                  <p className="dice-info-intro">
                    Manapally rolls with the cryptographically secure random generator built into your
                    browser, so every roll is fair and unpredictable
                  </p>
                  <div className="property-card-section">
                    <h4>Two standard dice</h4>
                    <p>
                      Each turn rolls two six sided dice showing 1 to 6 and your token moves their total,
                      three doubles in a row sends you to Jail
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Perfectly fair with rejection sampling</h4>
                    <p>
                      Random bytes run from 0 to 255 and 256 does not divide evenly by 6, so any byte of
                      252 or more is discarded and drawn again, leaving exactly 42 values per face
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Real dice probabilities</h4>
                    <ul className="dice-probability-list">
                      <li><strong>7</strong> is the most common total with 6 ways to roll it</li>
                      <li><strong>6 and 8</strong> follow closely with 5 ways each</li>
                      <li><strong>2 and 12</strong> are the rarest with 1 way each</li>
                    </ul>
                  </div>
                  <p className="dice-info-footer">May fortune favour your strategy</p>
                </div>
              </div>
            </div>
          )}

          {sheet === 'end' && canProposeEnd && (
            <div className="property-card-overlay end-overlay" onClick={() => setSheet(null)}>
              <div
                className="property-card end-sheet"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-labelledby="end-title"
              >
                <header className="property-card-header">
                  <p className="property-card-kicker">End the match early</p>
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
                  <p className="end-sheet-text">
                    The crown goes to the highest total net worth right now, cash plus every property held
                  </p>
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
              <div className="property-card end-sheet" role="dialog" aria-labelledby="vote-title">
                <header className="property-card-header">
                  <p className="property-card-kicker">A vote at the table</p>
                  <h3 id="vote-title">
                    {players.find((player) => player.id === endVote.proposerId)?.name} wants to end the game
                  </h3>
                </header>
                <div className="property-card-body">
                  <p className="end-sheet-text">
                    If everyone agrees the match ends now and the crown goes to the highest total net worth
                  </p>
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

          {sheet === 'match' && (
            <div className="property-card-overlay" onClick={() => setSheet(null)}>
              <div className="property-card match-info-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="match-info-title">
                <header className="property-card-header">
                  <p className="property-card-kicker">Match rules</p>
                  <h3 id="match-info-title">How a match ends</h3>
                  <button type="button" className="property-card-close" onClick={() => setSheet(null)} aria-label="Close match information">
                    ✕
                  </button>
                </header>
                <div className="property-card-body dice-info-body">
                  <p className="dice-info-intro">
                    The richest estate wins, measured by total net worth when the match ends
                  </p>
                  <div className="property-card-section">
                    <h4>Three ways to finish</h4>
                    <ul className="dice-probability-list">
                      <li>All {TOTAL_MATCH_TURNS} turns shared by the table have been played</li>
                      <li>Every player except one has gone bankrupt</li>
                      <li>Everyone at the table agrees to end the game with End game</li>
                    </ul>
                  </div>
                  <div className="property-card-section">
                    <h4>Net worth</h4>
                    <p>
                      Cash plus the purchase value of every district, station and utility you hold, plus half
                      the cost of your houses and hotels, mortgaged property counts at its value minus the
                      mortgage
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Doubles and Jail</h4>
                    <p>
                      Doubles earn another roll, while three doubles in one turn, the Go to Jail corner
                      or certain cards send you to Jail, and to leave you can pay {formatRupees(DETENTION_FINE)}, spend
                      a pardon or roll doubles, after {DETENTION_MAX_ATTEMPTS} misses the fine is paid for you, and
                      you still collect rent while held
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Your turn</h4>
                    <p>
                      Take as long as you like before rolling, then after your move you have{' '}
                      {Math.round(DEFAULT_TIMING.actionWindow / 1000)} seconds to build houses and hotels before the
                      turn passes on, or press End turn, rent, taxes and the Go reward move only once their pop up closes
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Taxes</h4>
                    <p>
                      Income Tax asks {formatRupees(TAXES[4])} and Luxury Tax asks {formatRupees(TAXES[38])}, the amounts are
                      printed on their spaces
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Houses and hotels</h4>
                    <p>
                      Own every district in a colour family to build, one house at a time and evenly across the
                      family, a fifth build becomes a hotel and buildings sell back for half their cost
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Trading</h4>
                    <p>
                      Trade properties, cash and Get Out of Jail Free cards with any player at any time, even
                      on another turn or from Jail, both sides must give something, houses and hotels cannot be
                      traded so sell every building in a colour family before trading any of it, and whoever
                      receives a mortgaged property pays the bank 10% of the mortgage at once or lifts it in full
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Auctions</h4>
                    <p>
                      When a player declines an unowned space it goes to auction straight away, bids rise in
                      steps of {formatRupees(AUCTION_INCREMENT)} and a late bid keeps the clock open a few
                      seconds longer
                    </p>
                  </div>
                  <div className="property-card-section">
                    <h4>Running short</h4>
                    <p>
                      If you cannot pay, buildings are sold and districts mortgaged automatically, and if that
                      is still not enough you are bankrupt and your estate passes to the player you owed
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="turn-panel">
          <p className="eyebrow">Current turn</p>

          <div className="turn-player">
            <span className={`turn-token seat-${activePlayer.pieceKey}`}>
              <PieceMark piece={activePlayer.pieceKey} variant="token" title={activePlayer.name} />
            </span>
            <div>
              <strong>{activePlayer.id === myPlayerId ? 'Your turn' : activePlayer.name}</strong>
              <span>
                {state.gameOver
                  ? 'The match is over'
                  : activePlayer.id === myPlayerId
                    ? inActionWindow
                      ? 'Build before your turn ends'
                      : state.busy
                        ? 'Your move is under way'
                        : 'Take your time, roll when ready'
                    : activePlayer.away
                      ? 'Away, the computer is playing'
                      : `${kindLabel(activePlayer)} is making a move`}
              </span>
            </div>
          </div>

          <div
            className={`dice-display ${state.rolling ? 'dice-display--rolling' : ''}`}
            aria-live="polite"
            aria-label={state.dice ? `Rolled ${state.dice[0]} and ${state.dice[1]}` : 'Dice ready'}
          >
            <div className="dice-pair">
              <DieFace value={state.dice?.[0]} />
              <DieFace value={state.dice?.[1]} />
            </div>
            <span className="dice-total">
              {state.dice ? `Total ${state.dice[0] + state.dice[1]}` : state.rolling ? 'Rolling' : 'Ready to roll'}
            </span>
          </div>

          {state.debt && state.debt.playerId !== myPlayerId && !state.gameOver && (
            <p className="debt-banner" role="status">
              <RadialDial key={state.debt.endsAt} endsAt={localTime(state.debt.endsAt)} length={state.debt.length} />
              {players.find((player) => player.id === state.debt.playerId)?.name} is raising{' '}
              {formatRupees(Math.max(0, state.debt.amount - (state.balances[state.debt.playerId] || 0)))} for{' '}
              {state.debt.reason}
            </p>
          )}

          {state.turnPhase === 'actions' && !state.gameOver && (
            <div className={`action-window ${actionSeconds <= 3 ? 'action-window--urgent' : ''}`} aria-live="polite">
              <svg className="action-ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="19" />
                <circle cx="22" cy="22" r="19" style={{ strokeDashoffset: `${119.4 * (1 - actionShare)}` }} />
              </svg>
              <strong>{actionSeconds}</strong>
              <span>
                {inActionWindow
                  ? 'seconds to build houses and hotels before your turn ends'
                  : `seconds for ${activePlayer.name} to build before the turn ends`}
              </span>
            </div>
          )}

          {inActionWindow ? (
            <GoldButton onClick={() => act({ type: 'end-turn' })}>End turn</GoldButton>
          ) : (
            <GoldButton
              loading={isMyTurn && state.busy && !state.gameOver}
              disabled={!canRoll}
              onClick={() => act({ type: 'roll' })}
            >
              {state.gameOver
                ? 'Match complete'
                : !amAlive
                  ? 'You are bankrupt'
                  : isMyTurn
                    ? myDetention
                      ? 'Roll for doubles'
                      : rollAgain
                        ? 'Doubles, roll again'
                        : 'Roll the dice'
                    : `Waiting for ${activePlayer.name}`}
            </GoldButton>
          )}

          {endVote && !state.gameOver && !mustVote && (
            <div className={`end-vote-status ${endVote.passed ? 'end-vote-status--passed' : ''}`} aria-live="polite">
              <p className="eyebrow">{endVote.passed ? 'Game ending' : 'Vote to end the game'}</p>
              <p>
                {endVote.passed
                  ? 'Everyone agreed, the final standings appear when this turn is over'
                  : `Waiting for ${waitingOn.map((player) => player.name).join(' and ')} to agree`}
              </p>
              {!endVote.passed && iAmVoter && (
                <button type="button" className="text-link" onClick={() => act({ type: 'end-vote', agree: false })}>
                  Cancel the vote
                </button>
              )}
            </div>
          )}

          {myDetention && amAlive && !state.gameOver && (
            <div className="detention-panel">
              <p>
                You are in Jail, attempt {detainedFor(myPlayerId) + 1} of {DETENTION_MAX_ATTEMPTS}, roll doubles
                to walk free or leave now and roll as normal
              </p>
              <div className="detention-actions">
                <button
                  type="button"
                  className="property-action-btn"
                  disabled={!canRoll || state.balances[myPlayerId] < DETENTION_FINE}
                  onClick={() => act({ type: 'roll', release: 'pay' })}
                >
                  Pay {formatRupees(DETENTION_FINE)} fine
                </button>
                <button
                  type="button"
                  className="property-action-btn"
                  disabled={!canRoll || !(state.pardons[myPlayerId] > 0)}
                  onClick={() => act({ type: 'roll', release: 'pardon' })}
                >
                  Use a pardon ({state.pardons[myPlayerId] || 0})
                </button>
              </div>
            </div>
          )}

          {buildable.length > 0 && amAlive && (
            <div className={`build-prompt ${canDevelopNow ? 'build-prompt--open' : ''}`}>
              <p className="eyebrow">{canDevelopNow ? 'Ready to build' : 'Build on your turn'}</p>
              <div className="build-prompt-list">
                {buildable.map(([family, spaceId]) => (
                  <button
                    key={family}
                    type="button"
                    className="build-chip"
                    style={{ '--family': `var(--color-${family})` }}
                    onClick={() => setSelectedProperty(spaceId)}
                  >
                    <span aria-hidden="true" />
                    {family.charAt(0).toUpperCase() + family.slice(1)} family
                  </button>
                ))}
              </div>
            </div>
          )}

          {state.gameOver && !showResults && (
            <button type="button" className="text-link results-reopen" onClick={() => setShowResults(true)}>
              Show final standings <span aria-hidden="true">›</span>
            </button>
          )}

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
                {players
                  .filter((player) => player.code)
                  .map((player) => (
                    <li key={player.id} className={`seat-${player.pieceKey} ${player.id === myPlayerId ? 'is-mine' : ''}`}>
                      <PieceMark piece={player.pieceKey} variant="token" />
                      <span>{player.id === myPlayerId ? 'You' : player.name}</span>
                      <code>{player.code}</code>
                    </li>
                  ))}
              </ul>
              <p className="player-ids-note">
                Dropped out? Open Manapally, choose Rejoin and enter the room code with your Player ID
              </p>
            </section>
          )}

          {(myOffers.length > 0 || offersToMe.length > 0) && (
            <section className="trade-pending" aria-label="Trade offers">
              <p className="eyebrow">Trade offers</p>
              <ul>
                {offersToMe.map((trade) => (
                  <li key={trade.id}>
                    <span>From {nameOf(trade.from)}</span>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setHiddenTrades((list) => list.filter((id) => id !== trade.id))}
                    >
                      Review
                    </button>
                  </li>
                ))}
                {myOffers.map((trade) => (
                  <li key={trade.id}>
                    <span>To {nameOf(trade.to)}, waiting</span>
                    <button type="button" className="text-link" onClick={() => act({ type: 'trade-cancel', tradeId: trade.id })}>
                      Withdraw
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canTrade && (
            <button type="button" className="view-cards-button trade-button" onClick={() => openTrade()}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 8h14l-4-4M20 16H6l4 4" />
              </svg>
              Trade
            </button>
          )}

          <button
            type="button"
            className="view-cards-button"
            onClick={() => {
              setCardsFor(myPlayerId || players[0].id);
              setSheet('cards');
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h11a2 2 0 0 1 2 2v12M4 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 12h13" />
            </svg>
            View everyone's cards
          </button>

          <div className="dice-info-row">
            <p className="dice-transparency-label">Secure roll by Web Crypto</p>
            <button type="button" className="dice-info-button" onClick={() => setSheet('dice')}>
              How the dice work
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}

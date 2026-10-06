// Voice for one player at the table.
//
// Joining a channel asks for the microphone and opens a WebRTC audio link to
// every other member: browser to browser where the network allows, through
// a free TURN relay (also over TLS on port 443) where it does not. The room
// session carries the set-up messages, through the host, on whichever route
// this player is connected by, Direct or Relay, so signalling works on every
// network the game itself works on.
//
// When a link cannot be made at all (a network that blocks every kind of
// WebRTC), that listener falls back to walkie-talkie: hold the talk button,
// and the clip is recorded, sealed for each listener (see voiceCrypto) and
// sent through the room like any other message.
import { fromBase64, newVoiceKeys, seal, sharedKey, toBase64, unseal } from './voiceCrypto';
import { voiceIceServers } from './voiceIce';

const CONNECT_TIMEOUT = 9000;
const CLIP_PART_CHARS = 24000;
const MAX_CLIP_MS = 20000;
const LEVEL_EVERY = 120;

// ?voice=walkie skips live audio and uses walkie-talkie clips, as a network
// that blocks every kind of WebRTC would. For tests and for trying it out.
const forcedWalkie = () => {
  try {
    return new URLSearchParams(window.location.search).get('voice') === 'walkie';
  } catch {
    return false;
  }
};

export const voiceSupported = () =>
  typeof window !== 'undefined' && Boolean(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);

export default class VoiceClient {
  constructor(session) {
    this.session = session;
    this.listeners = new Set();
    this.peers = new Map(); // clientId -> { pc, mode, route, audio, volume, level, pending: [] }
    this.roster = (session.isHost ? session.voiceRoster() : session.voiceRosterCache) || { channels: [], people: {} };
    this.channel = null;
    this.stream = null;
    this.muted = false;
    this.deafened = false;
    this.talking = false;
    this.invites = [];
    this.error = null;
    this.keys = newVoiceKeys();
    this.sharedKeys = new Map();
    this.clips = new Map();
    this.levels = {};
    this.offs = [
      session.on('voice-roster', (roster) => this.onRoster(roster)),
      session.on('voice-signal', (message) => this.onSignal(message)),
      session.on('voice-clip', (message) => this.onClip(message)),
      session.on('voice-invite', (message) => this.onInvite(message)),
      session.on('closed', () => this.destroy()),
      session.on('voice-close', () => this.destroy()),
    ];
  }

  get me() {
    return this.session.myClientId;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    this.listeners.forEach((fn) => fn(this));
  }

  // ------------------------------------------------------------ channels

  async ensureMic() {
    this.error = null;
    if (!voiceSupported()) {
      this.error = 'This browser cannot do voice';
      this.changed();
      return false;
    }
    try {
      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        this.stream.getAudioTracks().forEach((track) => {
          track.enabled = !this.muted;
        });
        this.watchLevel(this.me, this.stream);
      }
    } catch {
      this.error = 'Microphone permission was not given';
      this.changed();
      return false;
    }
    return true;
  }

  async join(channelId) {
    if (!(await this.ensureMic())) return;
    this.invites = this.invites.filter((invite) => invite.channel !== channelId);
    this.session.sendVoice({ t: 'voice-join', channel: channelId, key: this.keys.publicKey });
  }

  async createChannel(name, invite) {
    if (!(await this.ensureMic())) return;
    this.session.sendVoice({ t: 'voice-create', name, invite, key: this.keys.publicKey });
  }

  leave() {
    if (this.channel) this.session.sendVoice({ t: 'voice-leave' });
    this.closeAll();
    this.stopMyLevel?.();
    this.stopMyLevel = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.channel = null;
    this.changed();
  }

  dismissInvite(channelId) {
    this.invites = this.invites.filter((invite) => invite.channel !== channelId);
    this.changed();
  }

  setMuted(muted) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.changed();
  }

  setDeafened(deafened) {
    this.deafened = deafened;
    this.peers.forEach((peer) => {
      if (peer.audio) peer.audio.muted = deafened;
    });
    this.changed();
  }

  setVolume(clientId, volume) {
    const peer = this.peers.get(clientId);
    if (!peer) return;
    peer.volume = volume;
    if (peer.audio) peer.audio.volume = volume;
    this.changed();
  }

  members() {
    const channel = this.roster.channels.find((entry) => entry.id === this.channel);
    return channel ? channel.members.filter((id) => id !== this.me) : [];
  }

  onRoster(roster) {
    this.roster = roster || { channels: [], people: {} };
    const mine = this.roster.channels.find((channel) => channel.members.includes(this.me));
    this.channel = mine ? mine.id : null;
    if (!mine) this.closeAll();
    const wanted = new Set(mine ? mine.members.filter((id) => id !== this.me) : []);
    [...this.peers.keys()].forEach((id) => !wanted.has(id) && this.closePeer(id));
    wanted.forEach((id) => !this.peers.has(id) && this.openPeer(id));
    this.changed();
  }

  onInvite(message) {
    if (this.invites.some((invite) => invite.channel === message.channel)) return;
    this.invites = [...this.invites, { channel: message.channel, name: message.name, from: message.from }];
    this.changed();
  }

  // ---------------------------------------------------------- the links

  // The member with the lower id makes the offer, so two never collide.
  offers(id) {
    return String(this.me) < String(id);
  }

  async openPeer(id, { relayOnly = false } = {}) {
    const peer = { pc: null, mode: 'connecting', route: null, audio: null, volume: 1, pending: [], relayOnly };
    this.peers.set(id, peer);
    if (forcedWalkie()) {
      peer.mode = 'walkie';
      peer.route = 'walkie';
      this.changed();
      return;
    }
    this.changed();
    const servers = await voiceIceServers();
    if (this.peers.get(id) !== peer) return;

    const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
    peer.pc = pc;
    this.stream?.getTracks().forEach((track) => pc.addTrack(track, this.stream));
    if (!this.stream) pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(id, { candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams }) => {
      const audio = peer.audio || new Audio();
      audio.autoplay = true;
      audio.srcObject = streams[0];
      audio.volume = peer.volume;
      audio.muted = this.deafened;
      audio.play?.().catch(() => {});
      peer.audio = audio;
      this.watchLevel(id, streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        peer.mode = 'live';
        this.detectRoute(id, peer);
      } else if (pc.connectionState === 'failed') {
        this.giveUp(id, peer);
      }
      this.changed();
    };

    peer.timer = setTimeout(() => {
      if (this.peers.get(id) === peer && peer.mode !== 'live') this.giveUp(id, peer);
    }, CONNECT_TIMEOUT);

    if (this.offers(id)) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal(id, { sdp: pc.localDescription.toJSON(), relayOnly });
    }
  }

  // A link that does not come up is tried once more through TURN only, then
  // the pair falls back to walkie-talkie clips.
  giveUp(id, peer) {
    clearTimeout(peer.timer);
    if (!peer.relayOnly) {
      this.closePeer(id);
      this.signal(id, { restart: true });
      this.openPeer(id, { relayOnly: true });
      return;
    }
    peer.pc?.close();
    peer.pc = null;
    peer.mode = 'walkie';
    peer.route = 'walkie';
    this.changed();
  }

  async detectRoute(id, peer) {
    try {
      const stats = await peer.pc.getStats();
      let pair = null;
      stats.forEach((entry) => {
        if (entry.type === 'transport' && entry.selectedCandidatePairId) pair = stats.get(entry.selectedCandidatePairId);
      });
      if (!pair) stats.forEach((entry) => entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded' && (pair = entry));
      const local = pair && stats.get(pair.localCandidateId);
      const remote = pair && stats.get(pair.remoteCandidateId);
      peer.route = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'turn' : 'direct';
    } catch {
      peer.route = 'direct';
    }
    this.changed();
  }

  signal(to, data) {
    this.session.sendVoice({ t: 'voice-signal', to, data });
  }

  async onSignal({ from, data }) {
    if (!data) return;
    if (data.restart) {
      this.closePeer(from);
      if (this.members().includes(from)) this.openPeer(from, { relayOnly: true });
      return;
    }
    let peer = this.peers.get(from);
    if (!peer && this.members().includes(from)) {
      await this.openPeer(from, { relayOnly: Boolean(data.relayOnly) });
      peer = this.peers.get(from);
    }
    if (!peer) return;
    // Messages that arrive before the link is built wait their turn.
    for (let i = 0; i < 50 && !peer.pc; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const { pc } = peer;
    if (!pc) return;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.signal(from, { sdp: pc.localDescription.toJSON() });
        }
        const waiting = peer.pending.splice(0);
        // eslint-disable-next-line no-restricted-syntax
        for (const candidate of waiting) {
          // eslint-disable-next-line no-await-in-loop
          await pc.addIceCandidate(candidate).catch(() => {});
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch {
      // A stale or crossed message; the timeout above recovers the link.
    }
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    clearTimeout(peer.timer);
    peer.pc?.close();
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.pause?.();
    }
    peer.stopLevel?.();
    this.peers.delete(id);
    delete this.levels[id];
  }

  closeAll() {
    [...this.peers.keys()].forEach((id) => this.closePeer(id));
  }

  // ------------------------------------------------------ walkie-talkie

  walkiePeers() {
    return [...this.peers.entries()].filter(([, peer]) => peer.mode === 'walkie').map(([id]) => id);
  }

  startTalking() {
    if (!this.stream || this.talking || !window.MediaRecorder) return;
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(this.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24000 });
    const parts = [];
    recorder.ondataavailable = (event) => event.data.size && parts.push(event.data);
    recorder.onstop = async () => {
      const blob = new Blob(parts, { type: recorder.mimeType });
      await this.sendClip(new Uint8Array(await blob.arrayBuffer()), recorder.mimeType);
    };
    recorder.start();
    this.recorder = recorder;
    this.talking = true;
    this.talkTimer = setTimeout(() => this.stopTalking(), MAX_CLIP_MS);
    this.changed();
  }

  stopTalking() {
    clearTimeout(this.talkTimer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
    this.talking = false;
    this.changed();
  }

  async keyFor(id) {
    const theirs = this.roster.people?.[id]?.key;
    if (!theirs) return null;
    if (!this.sharedKeys.has(theirs)) this.sharedKeys.set(theirs, await sharedKey(this.keys.secret, theirs));
    return this.sharedKeys.get(theirs);
  }

  async sendClip(bytes, type) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await Promise.all(
      this.walkiePeers().map(async (to) => {
        const key = await this.keyFor(to);
        if (!key) return;
        const data = toBase64(await seal(key, bytes));
        const total = Math.ceil(data.length / CLIP_PART_CHARS);
        for (let part = 0; part < total; part += 1) {
          this.session.sendVoice({ t: 'voice-clip', to, id, part, total, type, data: data.slice(part * CLIP_PART_CHARS, (part + 1) * CLIP_PART_CHARS) });
        }
      }),
    );
  }

  async onClip({ from, id, part, total, type, data }) {
    if (this.deafened || typeof data !== 'string' || !Number.isInteger(total) || total > 200) return;
    const keyName = `${from}:${id}`;
    const clip = this.clips.get(keyName) || { parts: [], got: 0, at: Date.now() };
    if (clip.parts[part] === undefined) {
      clip.parts[part] = data;
      clip.got += 1;
    }
    this.clips.set(keyName, clip);
    // Old unfinished clips are dropped.
    this.clips.forEach((entry, name) => Date.now() - entry.at > 60000 && this.clips.delete(name));
    if (clip.got < total) return;
    this.clips.delete(keyName);
    try {
      const key = await this.keyFor(from);
      const bytes = await unseal(key, fromBase64(clip.parts.join('')));
      const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: type || 'audio/webm' })));
      audio.volume = this.peers.get(from)?.volume ?? 1;
      this.levels[from] = 0.6;
      this.changed();
      audio.onended = () => {
        this.levels[from] = 0;
        URL.revokeObjectURL(audio.src);
        this.changed();
      };
      await audio.play();
    } catch {
      // A clip that cannot be opened is skipped.
    }
  }

  // ------------------------------------------------------------- levels

  watchLevel(id, stream) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.audioContext = this.audioContext || new Context();
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      data.forEach((value) => {
        peak = Math.max(peak, Math.abs(value - 128) / 128);
      });
      const level = id === this.me && this.muted ? 0 : Math.min(1, peak * 2.5);
      const before = this.levels[id] || 0;
      this.levels[id] = level;
      if ((before > 0.08) !== (level > 0.08)) this.changed();
    }, LEVEL_EVERY);
    const stop = () => {
      clearInterval(timer);
      source.disconnect();
    };
    if (id === this.me) this.stopMyLevel = stop;
    else if (this.peers.get(id)) this.peers.get(id).stopLevel = stop;
  }

  speaking(id) {
    return (this.levels[id] || 0) > 0.08;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.offs.forEach((off) => off?.());
    this.leave();
    this.stopMyLevel?.();
    this.audioContext?.close?.().catch?.(() => {});
    this.listeners.clear();
  }
}

// One voice client per room session, kept for the life of the room so it
// carries over from the waiting room to the board.
const clients = new WeakMap();
export const voiceFor = (session) => {
  if (!session) return null;
  if (!clients.has(session)) clients.set(session, new VoiceClient(session));
  return clients.get(session);
};

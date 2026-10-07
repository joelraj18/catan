// The table rules a host picks before the game: the board, the turn timer,
// the discard limit on a 7, the points to win, how the number tokens may
// sit and how well the computer opponents play. Every value arriving from a
// lobby message or a saved game is checked against these choices, so a
// guest can never smuggle in a strange rule.

export const TIMER_CHOICES = [15, 30, 45, 60, 90, 0]; // seconds per move; 0 is no timer
export const HAND_LIMIT_CHOICES = [7, 8, 9, 10, 12];
export const VICTORY_CHOICES = [8, 10, 12, 14];
export const BOT_SKILL_CHOICES = ['casual', 'strong'];

export const DEFAULT_SETTINGS = {
  board: 'beginner', // 'beginner' | 'random'
  turnSeconds: 15,
  handLimit: 7, // more cards than this on a 7 means discarding half
  victoryPoints: 10,
  redsMayTouch: false, // 6 and 8 tokens may sit on neighbouring hexes
  extremesMayTouch: true, // 2 and 12 tokens may sit on neighbouring hexes
  botSkill: 'strong', // 'casual' plays the simple classic strategy
};

const pick = (value, choices, fallback) => (choices.includes(Number(value)) ? Number(value) : fallback);

export const cleanSettings = (input = {}) => ({
  board: input?.board === 'random' ? 'random' : 'beginner',
  turnSeconds: pick(input?.turnSeconds, TIMER_CHOICES, DEFAULT_SETTINGS.turnSeconds),
  handLimit: pick(input?.handLimit, HAND_LIMIT_CHOICES, DEFAULT_SETTINGS.handLimit),
  victoryPoints: pick(input?.victoryPoints, VICTORY_CHOICES, DEFAULT_SETTINGS.victoryPoints),
  redsMayTouch: typeof input?.redsMayTouch === 'boolean' ? input.redsMayTouch : DEFAULT_SETTINGS.redsMayTouch,
  extremesMayTouch:
    typeof input?.extremesMayTouch === 'boolean' ? input.extremesMayTouch : DEFAULT_SETTINGS.extremesMayTouch,
  botSkill: BOT_SKILL_CHOICES.includes(input?.botSkill) ? input.botSkill : DEFAULT_SETTINGS.botSkill,
});

// The rules a running game follows. Games saved before settings existed
// carry only a board, and play by the classic rules.
export const settingsOf = (state) => {
  const options = state?.options || {};
  return cleanSettings({ ...options, turnSeconds: options.turnSeconds ?? 0 });
};

export const victoryPointsOf = (state) => settingsOf(state).victoryPoints;
export const handLimitOf = (state) => settingsOf(state).handLimit;

export const botSkillLabel = (skill) => (skill === 'casual' ? 'Casual' : 'Strong');

export const timerLabel = (seconds) => {
  if (!seconds) return 'Off';
  return seconds === 60 ? '1 min' : `${seconds} s`;
};

// Labels and the channel name of server stats counters.
// Storage is in ./serverStats/store.js, renaming in ./serverStats/refresh.js,
// and create / change / delete in ./serverStats/manage.js.

import botConfig from '../config/bot.js';
import { DEFAULT_NOTATION, formatCount, notationOrDefault, pickNumber } from './serverStats/notation.js';

// The stored type list lives in serverStats/store.js (COUNTER_TYPES); the labels and base names here are for the UI and for channel creation.
// Keep the keys in step with COUNTER_TYPES — the parity is asserted by a test.
export const COUNTER_TYPE_CONFIG = {
  members: {
    label: 'Members + Bots',
    baseName: 'Members & Bots',
    emoji: '👥'
  },
  members_only: {
    label: 'Members Only',
    baseName: 'Members',
    emoji: '👤'
  },
  bots: {
    label: 'Bots Only',
    baseName: 'Bots',
    emoji: '🤖'
  },
  pending: {
    label: 'Pending Screening',
    baseName: 'Pending',
    emoji: '🕐'
  },
  norole: {
    label: 'Members Without Roles',
    baseName: 'No Role',
    emoji: '🙈'
  },
  channels: {
    label: 'All Channels',
    baseName: 'Channels',
    emoji: '#️⃣'
  },
  text_channels: {
    label: 'Text Channels',
    baseName: 'Text Channels',
    emoji: '💬'
  },
  voice_channels: {
    label: 'Voice Channels',
    baseName: 'Voice Channels',
    emoji: '🔊'
  },
  announcement_channels: {
    label: 'Announcement Channels',
    baseName: 'Announcements',
    emoji: '📢'
  },
  forum_channels: {
    label: 'Forum Channels',
    baseName: 'Forums',
    emoji: '🗂️'
  },
  stage_channels: {
    label: 'Stage Channels',
    baseName: 'Stages',
    emoji: '🎭'
  },
  categories: {
    label: 'Categories',
    baseName: 'Categories',
    emoji: '📂'
  },
  roles: {
    label: 'Roles',
    baseName: 'Roles',
    emoji: '🏷️'
  },
  emojis: {
    label: 'Emojis (all)',
    baseName: 'Emojis',
    emoji: '😀'
  },
  static_emojis: {
    label: 'Static Emojis',
    baseName: 'Static Emojis',
    emoji: '🙂'
  },
  animated_emojis: {
    label: 'Animated Emojis',
    baseName: 'Animated Emojis',
    emoji: '🤩'
  },
  stickers: {
    label: 'Stickers',
    baseName: 'Stickers',
    emoji: '🩹'
  },
  boosts: {
    label: 'Boosts',
    baseName: 'Boosts',
    emoji: '🚀'
  },
  boost_tier: {
    label: 'Boost Tier',
    baseName: 'Boost Tier',
    emoji: '💎'
  },
  bans: {
    label: 'Bans',
    baseName: 'Bans',
    emoji: '🔨'
  },
  role: {
    label: 'Specific Role',
    baseName: 'Role',
    emoji: '🏷️'
  },
  goal: {
    label: 'Goal',
    baseName: 'Goal',
    emoji: '🎯'
  },
  connected: {
    label: 'Connected (online + idle + dnd)',
    baseName: 'Connected',
    emoji: '🟢'
  },
  online: {
    label: 'Online',
    baseName: 'Online',
    emoji: '🟢'
  },
  idle: {
    label: 'Idle',
    baseName: 'Idle',
    emoji: '🟡'
  },
  dnd: {
    label: 'Do Not Disturb',
    baseName: 'DND',
    emoji: '🔴'
  },
  offline: {
    label: 'Offline',
    baseName: 'Offline',
    emoji: '⚫'
  },
  streaming: {
    label: 'Streaming',
    baseName: 'Streaming',
    emoji: '📺'
  },
  game: {
    label: 'Counter game',
    baseName: 'Game',
    emoji: '🎮'
  },
  social: {
    label: 'Counter sosial',
    baseName: 'Social',
    emoji: '🔗'
  }
};

function getCounterConfig(type) {
  return COUNTER_TYPE_CONFIG[type] || {
    label: 'Unknown',
    baseName: 'Counter',
    emoji: '❓'
  };
}

export function getCounterTypeLabel(type) {
  return getCounterConfig(type).label;
}

export function getCounterBaseName(type) {
  return getCounterConfig(type).baseName;
}

/** The base name for a role counter: the role's name, tidied for a channel name. */
export function getRoleCounterBaseName(roleName) {
  const clean = String(roleName ?? '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 80) || 'Role';
}

/** Fresh config lookup: unknown types fall back to the question mark. */
export function getCounterEmoji(type) {
  return getCounterConfig(type).emoji;
}

/** The name a goal counter carries: its stat, progress and target. Both numbers use the server notation. */
export function formatGoalName(goalStat, count, goal, notation = DEFAULT_NOTATION) {
  const base = getCounterBaseName(goalStat);
  const formattedCount = Number.isFinite(Number(count)) ? formatCount(count, notation) : '0';
  return `Goal ${base} ${formattedCount} / ${formatCount(goal, notation)}`;
}

/**
 * The name a goal counter channel should carry. A free-form name the admin chose is kept:
 * the progress number inside it is replaced (leftmost on a tie, because it always comes first);
 * the target stays put. Falls back to the default template when the name has no usable number.
 */
export function computeGoalName(currentName, count, goal, notation = DEFAULT_NOTATION, goalStat = 'members', preferred = null) {
  const formatted = formatCount(count, notation);
  const current = String(currentName ?? '');
  const candidate = pickNumber(current, count, preferred, 'leftmost');
  if (candidate) {
    const next = current.slice(0, candidate.start) + formatted + current.slice(candidate.end);
    if (next.length <= DISCORD_CHANNEL_NAME_LIMIT) return { name: next, source: 'custom' };
  }
  return { name: formatGoalName(goalStat, count, goal, notation), source: 'template' };
}

export function formatCounterChannelName(type, count, notation = DEFAULT_NOTATION, baseName = null) {
  const template = botConfig.counters?.defaults?.channelName || '{name}: {count}';
  return template
    .replaceAll('{name}', baseName ?? getCounterBaseName(type))
    .replaceAll('{count}', formatCount(count, notation));
}

const DISCORD_CHANNEL_NAME_LIMIT = 100;

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The name a counter channel should carry. A free-form name the admin chose is kept:
 * the number inside it is replaced with `count` written in `notation`. Falls back to the
 * configured template when the name has no usable number or the result would be too long.
 * `preferred` may carry the number the bot itself wrote last time to win ties in ambiguous names.
 *
 * The old default template wrote `{name}-{count}`; a channel carrying exactly that shape for this
 * counter is the bot's own output from before the template became `{name}: {count}` — not an admin's
 * name — so it is rewritten to the new format on the next rename instead of keeping the hyphen.
 * Anything with more than `{name}-{number}` (even a trailing word) is kept as the admin's name.
 */
export function computeCounterName(currentName, type, count, notation = DEFAULT_NOTATION, preferred = null, baseName = null) {
  const use = notationOrDefault(notation);
  const formatted = formatCount(count, use);
  const current = String(currentName ?? '');
  const base = String(baseName ?? getCounterBaseName(type));
  const legacyTemplate = new RegExp(`^${escapeRegExp(base)}-\\d[\\d.,KMB]*$`, 'i').test(current);
  if (!legacyTemplate) {
    const candidate = pickNumber(current, count, preferred);
    if (candidate) {
      const next = current.slice(0, candidate.start) + formatted + current.slice(candidate.end);
      if (next.length <= DISCORD_CHANNEL_NAME_LIMIT) return { name: next, source: 'custom' };
    }
  }
  return { name: formatCounterChannelName(type, count, use, baseName), source: 'template' };
}

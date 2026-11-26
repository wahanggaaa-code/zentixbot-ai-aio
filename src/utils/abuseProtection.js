// abuseProtection.js

import { checkRateLimit, getRateLimitStatus, clearAllRateLimits } from './rateLimiter.js';
import { logger } from './logger.js';

const DEFAULT_PROTECTION_POLICY = Object.freeze({
  maxAttempts: 2,
  windowMs: 30_000
});

const DEFAULT_ANOMALY_POLICY = Object.freeze({
  threshold: 3,
  windowMs: 5 * 60_000
});

const RISKY_COMMAND_CATEGORIES = new Set([
  'moderation',
  'ticket',
  'config'
]);

const RISKY_COMMAND_NAMES = new Set([
  'wipedata',
  'massban',
  'masskick',
  'ban',
  'kick',
  'timeout',
  'untimeout',
  'purge',
  'warn',
  'unban',
  'lock',
  'unlock',
  'ticket',
  'reactroles'
]);

// Detection history is separate from enforcement: saturation may reduce anomaly
// reporting, but must never make a blocked command succeed.
export function createBlockedAttemptTracker({ maxEntries = 50_000, now = Date.now } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer');
  const entries = new Map();
  let nextCapacitySweep = 0;
  function sweep() {
    const time = now();
    nextCapacitySweep = time + 1000;
    let removed = 0;
    for (const [key, entry] of entries) {
      if (time - entry.windowStart > entry.retentionMs) { entries.delete(key); removed++; }
    }
    return removed;
  }
  function record(key, { threshold, windowMs }) {
    const time = now();
    let entry = entries.get(key);
    if (!entry || time - entry.windowStart > windowMs) {
      if (!entry && entries.size >= maxEntries) {
        if (time >= nextCapacitySweep) sweep();
        if (entries.size >= maxEntries) return { saturated: true, reached: false };
      }
      entries.set(key, { count: 1, windowStart: time, retentionMs: windowMs, thresholdReachedAt: null });
      return { saturated: false, reached: false };
    }
    entry.retentionMs = Math.max(entry.retentionMs, windowMs);
    entry.count++;
    if (entry.count >= threshold && entry.thresholdReachedAt === null) {
      entry.thresholdReachedAt = time;
      return { saturated: false, reached: true, count: entry.count };
    }
    return { saturated: false, reached: false };
  }
  return { record, sweep, clear: () => entries.clear(), get size() { return entries.size; } };
}

const ANOMALY_MAX_ENTRIES = 50_000;
const blockedAttemptStore = createBlockedAttemptTracker({ maxEntries: ANOMALY_MAX_ENTRIES });
export function getAbuseTrackerMemoryStats() { return { size: blockedAttemptStore.size, maxEntries: ANOMALY_MAX_ENTRIES }; }
const anomalySweepTimer = setInterval(() => blockedAttemptStore.sweep(), 60_000);
anomalySweepTimer.unref?.();
let lastSaturationWarning = 0;

function normalizeCommandCategory(command) {
  return String(command?.category || '').trim().toLowerCase();
}

function normalizeCommandName(commandName) {
  return String(commandName || '').trim().toLowerCase();
}

function getCommandPolicy(command) {
  const protection = command?.abuseProtection || {};
  const maxAttempts = Number.isInteger(protection.maxAttempts) && protection.maxAttempts > 0
    ? protection.maxAttempts
    : DEFAULT_PROTECTION_POLICY.maxAttempts;
  const windowMs = Number.isInteger(protection.windowMs) && protection.windowMs > 0
    ? protection.windowMs
    : DEFAULT_PROTECTION_POLICY.windowMs;

  return { maxAttempts, windowMs };
}

function getAnomalyPolicy(command) {
  const anomaly = command?.abuseProtection?.anomaly || {};
  const threshold = Number.isInteger(anomaly.threshold) && anomaly.threshold > 0
    ? anomaly.threshold
    : DEFAULT_ANOMALY_POLICY.threshold;
  const windowMs = Number.isInteger(anomaly.windowMs) && anomaly.windowMs > 0
    ? anomaly.windowMs
    : DEFAULT_ANOMALY_POLICY.windowMs;

  return { threshold, windowMs };
}

function getProtectionKey(interaction, commandName) {
  const guildScope = interaction.guildId || 'dm';
  const userId = interaction.user?.id || 'unknown_user';
  return `${guildScope}:${userId}:${normalizeCommandName(commandName)}`;
}

function recordBlockedAttempt(key, commandName, interaction, command, remainingMs) {
  const anomalyPolicy = getAnomalyPolicy(command);
  const result = blockedAttemptStore.record(key, anomalyPolicy);
  if (result.saturated && Date.now() - lastSaturationWarning >= 60_000) {
    lastSaturationWarning = Date.now();
    logger.warn('Abuse anomaly tracking is full; new anomaly histories are temporarily not recorded. Cooldown enforcement remains active.', {
      event: 'interaction.command.abuse_tracking_full'
    });
  }
  if (result.reached) {
    logger.warn('Abuse anomaly detected for risky command cooldown breaches', {
      event: 'interaction.command.abuse_anomaly',
      guildId: interaction.guildId,
      userId: interaction.user?.id,
      command: normalizeCommandName(commandName),
      anomalyCount: result.count,
      anomalyWindowMs: anomalyPolicy.windowMs,
      cooldownRemainingMs: remainingMs
    });
  }
}

export function formatCooldownDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'a moment';
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

export function isRiskyCommand(command, commandName) {
  const protectionEnabled = command?.abuseProtection?.enabled;
  if (protectionEnabled === false) {
    return false;
  }

  if (protectionEnabled === true) {
    return true;
  }

  const normalizedName = normalizeCommandName(commandName);
  if (RISKY_COMMAND_NAMES.has(normalizedName)) {
    return true;
  }

  const normalizedCategory = normalizeCommandCategory(command);
  return RISKY_COMMAND_CATEGORIES.has(normalizedCategory);
}

export async function enforceAbuseProtection(interaction, command, commandName) {
  if (!isRiskyCommand(command, commandName)) {
    return {
      allowed: true,
      risky: false,
      remainingMs: 0,
      policy: null
    };
  }

  const policy = getCommandPolicy(command);
  const key = getProtectionKey(interaction, commandName);
  const allowed = await checkRateLimit(key, policy.maxAttempts, policy.windowMs);

  if (allowed) {
    return {
      allowed: true,
      risky: true,
      remainingMs: 0,
      policy
    };
  }

  const status = getRateLimitStatus(key, policy.windowMs);
  const remainingMs = Math.max(0, status?.remaining || 0);

  logger.info('Risky command blocked by cooldown policy', {
    event: 'interaction.command.abuse_blocked',
    guildId: interaction.guildId,
    userId: interaction.user?.id,
    command: normalizeCommandName(commandName),
    maxAttempts: policy.maxAttempts,
    windowMs: policy.windowMs,
    remainingMs,
    attemptCount: status?.attempts || 0
  });

  recordBlockedAttempt(key, commandName, interaction, command, remainingMs);

  return {
    allowed: false,
    risky: true,
    remainingMs,
    policy
  };
}

export function resetAbuseProtectionState() {
  blockedAttemptStore.clear();
  lastSaturationWarning = 0;
  clearAllRateLimits();
}
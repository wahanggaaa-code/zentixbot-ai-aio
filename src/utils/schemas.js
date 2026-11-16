// schemas.js

import { z } from 'zod';
import { createError, ErrorTypes } from './errorHandler.js';

export const LogIgnoreSchema = z
  .object({
    users: z.array(z.string()).default([]),
    channels: z.array(z.string()).default([])
  })
  .default({ users: [], channels: [] });

export const LoggingChannelsSchema = z
  .object({
    audit: z.string().nullable().optional(),
    applications: z.string().nullable().optional(),
    reports: z.string().nullable().optional(),
  })
  .default({ audit: null, applications: null, reports: null });

export const LoggingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    channels: z.union([z.undefined(), LoggingChannelsSchema]),
    ignore: z.union([z.undefined(), LogIgnoreSchema]),
    enabledEvents: z.record(z.string(), z.boolean()).default({}),
    // legacy flat fields — accepted on parse, stripped on normalize
    channelId: z.string().nullable().optional(),
  })
  .default({ enabled: false, enabledEvents: {} });

const TicketLoggingSchema = z
  .object({
    lifecycleChannelId: z.string().nullable().optional(),
    transcriptChannelId: z.string().nullable().optional()
  })
  .optional();

export const GuildConfigSchema = z
  .object({
    prefix: z.string().optional(),
    modRole: z.string().nullable().optional(),
    commandAccessRoleIds: z.array(z.string().max(32)).max(100).optional(),
    adminRole: z.string().nullable().optional(),
    logChannelId: z.string().nullable().optional(),
    welcomeChannel: z.string().nullable().optional(),
    welcomeMessage: z.string().optional(),
    autoRole: z.string().nullable().optional(),
    dmOnClose: z.boolean().optional(),
    reportChannelId: z.string().nullable().optional(),
    birthdayChannelId: z.string().nullable().optional(),
    premiumRoleId: z.string().nullable().optional(),
    logIgnore: z.union([z.undefined(), LogIgnoreSchema]),
    disabledCommands: z.record(z.string(), z.boolean()).optional(),
    disabledCategories: z.record(z.string(), z.boolean()).optional(),
    logging: z.union([z.undefined(), LoggingConfigSchema]),
    ticketLogging: TicketLoggingSchema.optional(),
    enableLogging: z.boolean().optional(),
    // Verification settings are no longer part of the schema; any stored
    // verification record from before the removal is stripped on normalize.
    verification: z.unknown().optional()
  })
  .passthrough();

const DEFAULT_LOGGING = {
  enabled: false,
  channels: { audit: null, applications: null, reports: null },
  ignore: { users: [], channels: [] },
  enabledEvents: {},
};

function migrateLoggingConfig(raw = {}, legacy = {}) {
  const base = typeof raw === 'object' && raw !== null ? raw : {};
  const {
    logChannelId,
    reportChannelId,
    enableLogging,
    logIgnore,
  } = legacy;

  const auditChannel =
    base.channels?.audit ??
    base.channelId ??
    logChannelId ??
    null;

  const applicationsChannel = base.channels?.applications ?? null;

  const reportsChannel =
    base.channels?.reports ??
    reportChannelId ??
    null;

  const ignore = {
    users: base.ignore?.users ?? logIgnore?.users ?? [],
    channels: base.ignore?.channels ?? logIgnore?.channels ?? [],
  };

  let enabled = base.enabled ?? false;
  if (enableLogging === false) {
    enabled = false;
  } else if (auditChannel && base.enabled === undefined && enableLogging !== false) {
    enabled = base.enabled ?? Boolean(enableLogging);
  }

  const { channelId: _legacyChannelId, ignore: _ignore, channels: _channels, ...rest } = base;

  return {
    ...DEFAULT_LOGGING,
    ...rest,
    enabled,
    channels: {
      audit: auditChannel,
      applications: applicationsChannel,
      reports: reportsChannel,
    },
    ignore,
    enabledEvents: base.enabledEvents ?? {},
  };
}

export function stripLegacyLoggingFields(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const {
    logChannelId: _logChannelId,
    enableLogging: _enableLogging,
    reportChannelId: _reportChannelId,
    logIgnore: _logIgnore,
    ...rest
  } = config;

  if (rest.logging && typeof rest.logging === 'object') {
    const { channelId: _channelId, ...loggingRest } = rest.logging;
    rest.logging = loggingRest;
  }

  return rest;
}

export function normalizeGuildConfig(raw, defaults = {}) {
  const base = typeof raw === 'object' && raw !== null ? raw : {};
  const merged = { ...defaults, ...base };

  merged.logging = migrateLoggingConfig(merged.logging, {
    logChannelId: merged.logChannelId,
    reportChannelId: merged.reportChannelId,
    enableLogging: merged.enableLogging,
    logIgnore: merged.logIgnore,
  });

  const parsed = GuildConfigSchema.safeParse(merged);
  const normalized = parsed.success ? parsed.data : { ...defaults, ...merged };
  // The verification module is gone; any stored record is dropped here, not carried forward.
  if (normalized && typeof normalized === 'object') delete normalized.verification;

  normalized.logging = migrateLoggingConfig(normalized.logging, {
    logChannelId: normalized.logChannelId,
    reportChannelId: normalized.reportChannelId,
    enableLogging: normalized.enableLogging,
    logIgnore: normalized.logIgnore,
  });

  return stripLegacyLoggingFields(normalized);
}

export function validateGuildConfigOrThrow(rawConfig, context = {}) {
  const normalized = normalizeGuildConfig(rawConfig);
  const parsed = GuildConfigSchema.safeParse(normalized);

  if (parsed.success) {
    return stripLegacyLoggingFields({
      ...normalized,
      logging: migrateLoggingConfig(normalized.logging, {}),
    });
  }

  throw createError(
    'Invalid guild configuration payload',
    ErrorTypes.VALIDATION,
    'Configuration payload is invalid. Please review provided values and try again.',
    {
      ...context,
      errorCode: 'VALIDATION_FAILED',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code
      }))
    }
  );
}

// settings.js — the server-wide switch for Social Alerts (per guild).
//
// One flag in the guild config row (`config.socialAlerts.enabled`). Absence means ON, so an
// upgrade never silently mutes a server. Turning it off makes the poller skip every alert;
// nothing is deleted and the per-alert pause switches keep their state.

import { getGuildConfig, patchGuildConfig } from '../config/guildConfig.js';

const CONTEXT = { source: 'social-alerts' };

export async function readSocialAlertsSettings(client, guildId) {
    const config = await getGuildConfig(client, guildId, CONTEXT);
    return { enabled: config?.socialAlerts?.enabled !== false };
}

export async function writeSocialAlertsSettings(client, guildId, enabled) {
    const value = Boolean(enabled);
    await patchGuildConfig(client, guildId, { socialAlerts: { enabled: value } }, CONTEXT);
    return { enabled: value };
}

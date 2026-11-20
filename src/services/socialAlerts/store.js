// store.js — stored social alerts, read and written directly on the database.
//
// One row per alert in `temp_data`, key `guild:{guildId}:social_alerts:{alertId}`.
//
// Same contract as the reaction-role panels: the generic key-value layer answers a failed
// read with "no data" and a failed write with `false`. That is not acceptable for rows the
// poller depends on, so here every failure is thrown, and a change is one transaction that
// holds a per-guild advisory lock from read to write. Rows this code cannot read are never
// touched: they stay exactly as they are and are counted in `rejected`.

import { createHash, randomBytes } from 'node:crypto';
import { pgConfig } from '../../config/database/postgres.js';
import { sqliteFor, readPrefixes, readRows, changeRows } from '../storage/sqliteRows.js';
import { getSocialAlertsPrefix, getSocialAlertKey } from '../../utils/database/keys.js';

const table = pgConfig.tables.temp_data;
const SNOWFLAKE = /^\d{17,20}$/;
const ALERT_ID = /^[a-z0-9_]{2,32}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const UPLOADS_PLAYLIST = /^UU[A-Za-z0-9_-]{22}$/;
const TWITCH_LOGIN = /^[a-z0-9_]{4,25}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export const MAX_ALERTS = 25;
export const MAX_LABEL = 100;
export const MAX_CUSTOM_MESSAGE = 500;
export const MAX_TEXT = 200;
export const PLATFORMS = ['youtube', 'twitch'];
export const YOUTUBE_NOTIFY_TYPES = ['video', 'live', 'shorts'];
export const DEFAULT_ACCENT_COLOR = '#5865F2';
/** `{creator} {title} {url} {platform} {role}` are the only placeholders replaced at send time. */
export const NOTE_ON_PLACEHOLDERS = 'creator: nama akun, title: judul konten, url: tautan konten, platform: YouTube/Twitch, role: mention yang dipilih';

export const fail = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const unavailable = () => fail('Database unavailable for social alerts', 'SOCIALALERTS_UNAVAILABLE');

const canonicalPrefix = (guildId) => getSocialAlertsPrefix(guildId);
export const alertKey = (guildId, alertId) => getSocialAlertKey(guildId, alertId);
/** `_` and `%` are wildcards in LIKE; the prefix must match literally. */
const like = (prefix) => `${prefix.replace(/[\\%_]/g, '\\$&')}%`;

/** The PostgreSQL pool. Throws SOCIALALERTS_UNAVAILABLE when PostgreSQL cannot be used right now. */
export function alertPool(client) {
    const db = client?.db;
    const status = db?.getStatus?.();
    if (status?.connectionType !== 'postgresql' || status.isDegraded || !db.isAvailable?.()
        || !db.db?.isAvailable?.() || typeof db.db.pool?.connect !== 'function') {
        throw unavailable();
    }
    return db.db.pool;
}

const asText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : null);
const asIso = (value) => (typeof value === 'string' && ISO.test(value) ? value : null);
const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const asColor = (value) => (typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim().toUpperCase() : null);
const asNotifyTypes = (value, platform) => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const allowed = platform === 'twitch' ? ['live'] : YOUTUBE_NOTIFY_TYPES;
    const clean = [...new Set(value.map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : '')))];
    if (clean.length === 0 || clean.some((item) => !allowed.includes(item))) return null;
    if (clean.length !== value.length) return null;
    return clean;
};
const asMentionRoleId = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (value === 'everyone') return 'everyone';
    if (typeof value === 'string' && SNOWFLAKE.test(value.trim())) return value.trim();
    return undefined; // invalid: callers reject the alert instead of silently losing the mention
};

/**
 * Validate and normalize one alert. Returns the clean record (without `id`, `createdAt`, `updatedAt`),
 * or null when the input cannot describe a usable alert. Never throws: callers decide the error.
 */
export function normalizeAlert(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const platform = PLATFORMS.includes(input.platform) ? input.platform : null;
    if (!platform) return null;

    const targetChannelId = typeof input.targetChannelId === 'string' && SNOWFLAKE.test(input.targetChannelId) ? input.targetChannelId : null;
    const label = asText(input.label, MAX_LABEL);
    if (!targetChannelId || !label) return null;

    const notifyTypes = asNotifyTypes(input.notifyTypes ?? (platform === 'twitch' ? ['live'] : ['video']), platform);
    if (!notifyTypes) return null;

    const mentionRoleId = asMentionRoleId(input.mentionRoleId);
    if (mentionRoleId === undefined) return null;

    const alert = {
        platform,
        label,
        targetChannelId,
        mentionRoleId,
        notifyTypes,
        customMessage: asText(input.customMessage, MAX_CUSTOM_MESSAGE) ?? '',
        accentColor: input.accentColor === null ? null : asColor(input.accentColor) ?? DEFAULT_ACCENT_COLOR,
        aiSummaryEnabled: asBool(input.aiSummaryEnabled, false),
        enabled: asBool(input.enabled, true),
        lastPostId: asText(input.lastPostId, MAX_TEXT),
        lastLiveId: asText(input.lastLiveId, MAX_TEXT),
        isLive: asBool(input.isLive, false),
        lastCheckedAt: asIso(input.lastCheckedAt),
        lastError: asText(input.lastError, MAX_TEXT),
    };

    if (platform === 'youtube') {
        const channelId = typeof input.channelId === 'string' && CHANNEL_ID.test(input.channelId) ? input.channelId : null;
        const uploadsPlaylistId = typeof input.uploadsPlaylistId === 'string' && UPLOADS_PLAYLIST.test(input.uploadsPlaylistId) ? input.uploadsPlaylistId : null;
        if (!channelId) return null;
        alert.channelId = channelId;
        alert.uploadsPlaylistId = uploadsPlaylistId ?? `UU${channelId.slice(2)}`;
    } else {
        const login = typeof input.login === 'string' ? input.login.trim().toLowerCase() : '';
        if (!TWITCH_LOGIN.test(login)) return null;
        alert.login = login;
    }
    return alert;
}

/** Whether a value is a usable stored alert (id and timestamps included). */
export function isAlertShape(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (typeof entry.id !== 'string' || !ALERT_ID.test(entry.id)) return false;
    if (typeof entry.createdAt !== 'string' || !ISO.test(entry.createdAt)) return false;
    if (typeof entry.updatedAt !== 'string' || !ISO.test(entry.updatedAt)) return false;
    return normalizeAlert(entry) !== null;
}

// Stored rows may carry extra keys from older writers; normalize down to the known field set.
function decodeEntry(raw, guildId) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (!isAlertShape(value)) return null;
    return {
        ...normalizeAlert(value),
        id: value.id,
        guildId,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    };
}

function decodeRows(rows, guildId) {
    const alerts = [];
    const seen = new Set();
    let rejected = 0;
    for (const row of rows ?? []) {
        const value = row.value !== undefined ? row.value : row;
        const alert = decodeEntry(value, guildId);
        if (!alert || seen.has(alert.id)) {
            rejected += 1;
            continue;
        }
        seen.add(alert.id);
        alerts.push(alert);
    }
    return { alerts, rejected };
}

/** A content hash of the list. Not a version number: A→B→A is not detected. */
export function revisionOf(alerts) {
    const canonical = alerts.map((a) => [a.id, a.platform, a.channelId ?? null, a.login ?? null, a.targetChannelId, a.mentionRoleId, [...(a.notifyTypes ?? [])].sort(), a.customMessage, a.accentColor, a.aiSummaryEnabled, a.enabled, a.lastPostId, a.lastLiveId, a.isLive]);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function assertGuild(guildId) {
    if (!SNOWFLAKE.test(guildId || '')) throw fail('Invalid guild id', 'SOCIALALERTS_INVALID');
}

const SELECT = `SELECT key, value FROM ${table} WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > NOW())`;

/** Every stored alert of the guild. `rejected` counts rows this code cannot read. Throws on a database error. */
export async function readAlerts(client, guildId) {
    assertGuild(guildId);
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) return decodeRows(readPrefixes(sqlite, canonicalPrefix(guildId)), guildId);
    const pool = alertPool(client);
    const result = await pool.query(SELECT, [like(canonicalPrefix(guildId))]);
    return decodeRows(result.rows, guildId);
}

/** One stored alert or `null`. Throws on a database error. */
export async function readAlert(client, guildId, alertId) {
    assertGuild(guildId);
    if (typeof alertId !== 'string' || !ALERT_ID.test(alertId)) return null;
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) {
        const rows = [...readRows(sqlite, [alertKey(guildId, alertId)])].map(([key, value]) => ({ key, value }));
        return decodeRows(rows, guildId).alerts[0] ?? null;
    }
    const pool = alertPool(client);
    const result = await pool.query(
        `SELECT key, value FROM ${table} WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > NOW())`,
        [[alertKey(guildId, alertId)]],
    );
    return decodeRows(result.rows, guildId).alerts[0] ?? null;
}

/**
 * What a mutation asked for, checked against the alerts that exist. Returns the keys to
 * delete and the alerts to store, or null when nothing is to be written.
 */
function planChange(alerts, out, guildId) {
    if (!out || typeof out !== 'object' || typeof out.then === 'function') throw fail('Invalid alert mutation result', 'SOCIALALERTS_INVALID');
    if (out.write === false) return null;
    const remove = [...new Set(out.remove ?? [])];
    const put = out.put ?? [];
    if (remove.some((id) => !ALERT_ID.test(id))) throw fail('Invalid alert id', 'SOCIALALERTS_INVALID');
    const after = new Map(alerts.map((alert) => [alert.id, alert]));
    for (const id of remove) after.delete(id);
    for (const entry of put) {
        const alert = isAlertShape(entry) ? { ...normalizeAlert(entry), id: entry.id, createdAt: entry.createdAt, updatedAt: entry.updatedAt } : null;
        if (!alert) throw fail('Refusing to store an invalid alert', 'SOCIALALERTS_INVALID');
        after.set(alert.id, alert);
    }
    if (after.size > MAX_ALERTS && after.size > alerts.length) throw fail('Alert limit reached', 'SOCIALALERTS_LIMIT', { limit: MAX_ALERTS });
    return { remove, store: put.map((entry) => after.get(entry.id)) };
}

function mutateOnSQLite(sqlite, guildId, mutate) {
    return changeRows(sqlite, (rows) => {
        const { alerts } = decodeRows(rows.rows(canonicalPrefix(guildId)), guildId);
        const out = mutate(alerts.map((alert) => ({ ...alert })));
        const plan = planChange(alerts, out, guildId);
        if (plan) {
            for (const id of plan.remove) rows.del(alertKey(guildId, id));
            for (const alert of plan.store) rows.put(alertKey(guildId, alert.id), alert);
        }
        return out.result;
    });
}

/**
 * Change the guild's alerts inside one transaction.
 *
 * `mutate(alerts)` must be synchronous and free of Discord or network effects. It returns
 * `{put: [alert…], remove: [alertId…], result}` to write, or `{write: false, result}` to
 * leave everything untouched. Anything it throws rolls the transaction back and is passed on.
 * Rows this code cannot read are never touched.
 */
export async function mutateAlerts(client, guildId, mutate) {
    assertGuild(guildId);
    if (typeof mutate !== 'function' || mutate.constructor?.name === 'AsyncFunction') {
        throw fail('Alert mutation must be synchronous', 'SOCIALALERTS_INVALID');
    }
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) return mutateOnSQLite(sqlite, guildId, mutate);
    const pool = alertPool(client);
    const conn = await pool.connect();
    try {
        await conn.query('BEGIN');
        // One writer per guild: the alert limit counts rows, so a row lock alone would not hold it.
        await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zentix:social_alerts:${guildId}`]);
        const rows = await conn.query(`${SELECT} FOR UPDATE`, [like(canonicalPrefix(guildId))]);
        const { alerts } = decodeRows(rows.rows, guildId);

        const out = mutate(alerts.map((alert) => ({ ...alert })));
        const plan = planChange(alerts, out, guildId);
        if (!plan) {
            await conn.query('ROLLBACK');
            return out.result;
        }

        for (const id of plan.remove) {
            await conn.query(`DELETE FROM ${table} WHERE key = ANY($1::text[])`, [[alertKey(guildId, id)]]);
        }
        for (const alert of plan.store) {
            await conn.query(
                `INSERT INTO ${table} (key, value, expires_at) VALUES ($1, $2::jsonb, NULL)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL`,
                [alertKey(guildId, alert.id), JSON.stringify(alert)],
            );
        }
        await conn.query('COMMIT');
        return out.result;
    } catch (error) {
        await conn.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        conn.release();
    }
}

// ---------------------------------------------------------------------------
// Convenience API used by the poller, the dashboard routes and the tests.
// ---------------------------------------------------------------------------

const newAlertId = () => `sa_${randomBytes(9).toString('hex')}`;
const nowIso = () => new Date().toISOString();

/** Create an alert. Throws SOCIALALERTS_LIMIT / SOCIALALERTS_DUPLICATE / SOCIALALERTS_INVALID. */
export async function createAlert(client, guildId, input) {
    if (input?.accentColor !== undefined && input.accentColor !== null && !asColor(input.accentColor)) throw fail('Data alert tidak valid.', 'SOCIALALERTS_INVALID');
    const base = normalizeAlert(input);
    if (!base) throw fail('Data alert tidak valid.', 'SOCIALALERTS_INVALID');
    return mutateAlerts(client, guildId, (alerts) => {
        const duplicate = alerts.find((alert) => alert.platform === base.platform
            && (alert.channelId ?? alert.login) === (base.channelId ?? base.login)
            && alert.targetChannelId === base.targetChannelId);
        if (duplicate) throw fail('Alert untuk akun dan channel ini sudah ada.', 'SOCIALALERTS_DUPLICATE');
        const id = newAlertId();
        const stamp = nowIso();
        const alert = { ...base, id, createdAt: stamp, updatedAt: stamp };
        return { put: [alert], result: alert };
    });
}

/** Patch the user-facing fields of an alert. Throws SOCIALALERTS_NOT_FOUND / SOCIALALERTS_INVALID. */
export async function updateAlert(client, guildId, alertId, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail('Data ubah tidak valid.', 'SOCIALALERTS_INVALID');
    if (patch.accentColor !== undefined && patch.accentColor !== null && !asColor(patch.accentColor)) throw fail('Data ubah tidak valid.', 'SOCIALALERTS_INVALID');
    return mutateAlerts(client, guildId, (alerts) => {
        const index = alerts.findIndex((alert) => alert.id === alertId);
        if (index === -1) throw fail('Alert tidak ditemukan.', 'SOCIALALERTS_NOT_FOUND');
        const current = alerts[index];
        const merged = {
            ...current,
            targetChannelId: patch.targetChannelId ?? current.targetChannelId,
            mentionRoleId: patch.mentionRoleId === undefined ? current.mentionRoleId : patch.mentionRoleId,
            notifyTypes: patch.notifyTypes ?? current.notifyTypes,
            customMessage: patch.customMessage ?? current.customMessage,
            accentColor: patch.accentColor === undefined ? current.accentColor : patch.accentColor,
            aiSummaryEnabled: patch.aiSummaryEnabled ?? current.aiSummaryEnabled,
            enabled: patch.enabled ?? current.enabled,
            updatedAt: nowIso(),
        };
        const clean = normalizeAlert(merged);
        if (!clean) throw fail('Data alert tidak valid.', 'SOCIALALERTS_INVALID');
        return { put: [{ ...clean, id: current.id, createdAt: current.createdAt, updatedAt: merged.updatedAt }], result: { ...clean, id: current.id, createdAt: current.createdAt, updatedAt: merged.updatedAt } };
    });
}

/**
 * Record the poller's runtime state for an alert (latest seen ids, live flag, timestamps, last error).
 * Silent no-op when the alert no longer exists — a deletion racing the poller is not an error.
 */
export function markAlertState(client, guildId, alertId, state) {
    return mutateAlerts(client, guildId, (alerts) => {
        const index = alerts.findIndex((alert) => alert.id === alertId);
        if (index === -1) return { write: false, result: false };
        const current = alerts[index];
        const merged = {
            ...current,
            ...(state.lastPostId !== undefined ? { lastPostId: state.lastPostId } : {}),
            ...(state.lastLiveId !== undefined ? { lastLiveId: state.lastLiveId } : {}),
            ...(state.isLive !== undefined ? { isLive: state.isLive } : {}),
            ...(state.lastCheckedAt !== undefined ? { lastCheckedAt: state.lastCheckedAt } : {}),
            ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
            updatedAt: nowIso(),
        };
        const clean = normalizeAlert(merged);
        if (!clean) throw fail('Data alert tidak valid.', 'SOCIALALERTS_INVALID');
        const next = { ...clean, id: current.id, createdAt: current.createdAt, updatedAt: merged.updatedAt };
        return { put: [next], result: next };
    });
}

/** Delete an alert by id. Returns true when one was removed. */
export function deleteAlert(client, guildId, alertId) {
    if (!ALERT_ID.test(alertId || '')) return Promise.resolve(false);
    return mutateAlerts(client, guildId, (alerts) => {
        const found = alerts.some((alert) => alert.id === alertId);
        if (!found) return { write: false, result: false };
        return { remove: [alertId], result: true };
    });
}

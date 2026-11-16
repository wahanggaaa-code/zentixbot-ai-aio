// store.js — stored self-role panels (unified with reaction role panels), read and written directly on PostgreSQL.
//
// One row per panel in `temp_data`, key `guild:{guildId}:self_role:{messageId}`
// (older reaction role data may still sit under `guild:{guildId}:reaction_roles:{messageId}` or legacy keys).
//
// The generic key-value layer answers a failed read with "no data" and a failed
// write with `false`. For panels that meant: a short database problem let a sixth
// panel through the limit, a save that failed was reported as "Success", and a
// member was told the panel "is no longer active". Here every failure is thrown,
// and a change is one transaction that holds a per-guild lock from read to write.

import { createHash } from 'node:crypto';
import { pgConfig } from '../../config/database/postgres.js';
import { sqliteFor, readRow, readRows, readPrefixes, changeRows } from '../storage/sqliteRows.js';

const table = pgConfig.tables.temp_data;
const SNOWFLAKE = /^\d{17,20}$/;

export const MAX_PANELS = 5;
export const MAX_ROLES = 25;
export const MAX_TITLE = 256;
export const MAX_DESCRIPTION = 2048;

export const fail = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
export const isSnowflake = (value) => typeof value === 'string' && SNOWFLAKE.test(value);

const PANEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A panel id: a uuid minted at creation, or (for panels stored before ids existed) the snowflake of the panel message. */
export const isPanelId = (value) => typeof value === 'string' && (PANEL_ID.test(value) || isSnowflake(value));
const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/;
/** A custom emoji (`<a?:name:id>` or a bare snowflake id) or a short unicode emoji. */
export const isValidEmoji = (value) => {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (text.length === 0 || text.length > 48) return false;
    if (CUSTOM_EMOJI.test(text) || isSnowflake(text)) return true;
    if (/\s/.test(text)) return false;
    return [...text].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
};
export const MAX_BANNER_BYTES = 5 * 1024 * 1024;
const BANNER_MIMES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
/** File extension for an upload of `mime`, or null when the image type is not one we accept. */
export const bannerExtension = (mime) => BANNER_MIMES[mime] ?? null;
const BUTTON_STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];
export const isButtonStyle = (value) => BUTTON_STYLES.includes(value);
export const INTERACTION_TYPES = ['buttons', 'section_buttons', 'dropdown', 'reaction'];
export const BEHAVIOR_MODES = ['toggle', 'unique', 'verify'];

/** The PostgreSQL pool. Throws REACTROLES_UNAVAILABLE when PostgreSQL cannot be used right now. */
export function panelPool(client) {
    const db = client?.db;
    const status = db?.getStatus?.();
    if (status?.connectionType !== 'postgresql' || status.isDegraded || !db.isAvailable?.()
        || !db.db?.isAvailable?.() || typeof db.db.pool?.connect !== 'function') {
        throw fail('PostgreSQL unavailable for self-role panels', 'REACTROLES_UNAVAILABLE');
    }
    return db.db.pool;
}

const canonicalPrefix = (guildId) => `guild:${guildId}:self_role:`;
const legacyReactionPrefix = (guildId) => `guild:${guildId}:reaction_roles:`;
const legacyLegacyPrefix = (guildId) => `reaction_roles:${guildId}:`;
export const panelKey = (guildId, messageId) => `${canonicalPrefix(guildId)}${messageId}`;
const legacyReactionKey = (guildId, messageId) => `${legacyReactionPrefix(guildId)}${messageId}`;
const legacyLegacyKey = (guildId, messageId) => `${legacyLegacyPrefix(guildId)}${messageId}`;
/** `_` and `%` are wildcards in LIKE; the prefix must match literally. */
const like = (prefix) => `${prefix.replace(/[\\%_]/g, '\\$&')}%`;

function assertGuild(guildId) {
    if (!isSnowflake(guildId)) throw fail('Invalid guild id', 'REACTROLES_INVALID');
}

function cleanText(value, max) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length > 0 && text.length <= max ? text : null;
}

/**
 * A stored value as a panel, or `null` when this code cannot use it.
 * `items` array: { roleId, label, description, emoji, buttonStyle }
 * Supports migration from old reaction role panels.
 */
export function decodePanel(raw, guildId, messageId) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!isSnowflake(messageId) || !isSnowflake(value.channelId)) return null;
    if (value.messageId !== undefined && value.messageId !== messageId) return null;

    // Migration: old reaction role panel
    if (value.roles && !value.interactionType) {
        let roles = value.roles;
        if (roles && typeof roles === 'object' && !Array.isArray(roles)) roles = Object.values(roles);
        if (!Array.isArray(roles) || roles.some((id) => !isSnowflake(id))) return null;
        roles = [...new Set(roles)];
        if (roles.length > MAX_ROLES) return null;

        const panel = {
            id: isPanelId(value.id) ? value.id : messageId,
            guildId,
            channelId: value.channelId,
            messageId,
            items: roles.map(id => ({ roleId: id, label: null, description: null, emoji: null, buttonStyle: 'Primary' })),
            title: cleanText(value.title, MAX_TITLE) || 'Reaction Roles',
            description: cleanText(value.description, MAX_DESCRIPTION) || 'Select your roles using the menu below.',
            bannerUrl: null,
            accentColor: null,
            // The pre-unification panel was a select menu; it stays one. Its `reaction_roles`
            // custom id is still served, and it now honors the stored behavior mode.
            interactionType: 'dropdown',
            behaviorMode: 'toggle',
            requiredRoleId: null,
            maxSelect: 1,
            dropdownPlaceholder: 'Select your roles',
            createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
        };
        if (typeof value.updatedAt === 'string') panel.updatedAt = value.updatedAt;
        return panel;
    }

    // New unified SelfRolePanel
    const items = [];
    for (const rawItem of Array.isArray(value.items) ? value.items : []) {
        if (!rawItem || typeof rawItem !== 'object' || !isSnowflake(rawItem.roleId)) continue;
        const item = {
            roleId: rawItem.roleId,
            label: cleanText(rawItem.label, 80) ?? null,
            description: cleanText(rawItem.description, 100) ?? null,
            emoji: typeof rawItem.emoji === 'string' && isValidEmoji(rawItem.emoji) ? rawItem.emoji.trim() : null,
            buttonStyle: isButtonStyle(rawItem.buttonStyle) ? rawItem.buttonStyle : 'Primary',
        };
        if (items.some((entry) => entry.roleId === item.roleId)) continue;
        items.push(item);
    }
    const interactionType = value.interactionType || 'buttons'; // 'buttons' | 'section_buttons' | 'dropdown' | 'reaction'
    const behaviorMode = value.behaviorMode || 'toggle'; // 'toggle' | 'unique' | 'verify'
    const accentText = typeof value.accentColor === 'string' ? value.accentColor.replace(/^#/, '').trim().toLowerCase() : '';
    const panel = {
        id: isPanelId(value.id) ? value.id : messageId,
        guildId,
        channelId: value.channelId,
        messageId,
        items,
        title: cleanText(value.title, MAX_TITLE) || 'Self-Role',
        description: cleanText(value.description, MAX_DESCRIPTION) || 'Select your roles.',
        bannerUrl: cleanText(value.bannerUrl, 2048) ?? null,
        accentColor: /^[0-9a-f]{6}$/.test(accentText) ? accentText : null,
        interactionType,
        behaviorMode,
        requiredRoleId: isSnowflake(value.requiredRoleId) ? value.requiredRoleId : null,
        maxSelect: typeof value.maxSelect === 'number' && Number.isFinite(value.maxSelect) ? Math.max(1, Math.min(25, Math.floor(value.maxSelect))) : 1,
        dropdownPlaceholder: cleanText(value.dropdownPlaceholder, 100) || 'Select your roles',
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    };
    if (typeof value.updatedAt === 'string') panel.updatedAt = value.updatedAt;

    if (!INTERACTION_TYPES.includes(interactionType)) return null;
    if (!BEHAVIOR_MODES.includes(behaviorMode)) return null;
    // Validate items length
    if (panel.items.length === 0 || panel.items.length > MAX_ROLES) return null;

    return panel;
}

/** A content hash of one panel. Not a version number: A→B→A is not detected. */
export function revisionOf(panel) {
    const canonical = [
        panel.messageId, panel.channelId, panel.items, panel.title ?? null, panel.description ?? null,
        panel.bannerUrl ?? null, panel.accentColor ?? null, panel.interactionType, panel.behaviorMode,
        panel.requiredRoleId ?? null, panel.maxSelect, panel.dropdownPlaceholder ?? null
    ];
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function decodeRows(rows, guildId) {
    const byMessage = new Map();
    let rejected = 0;
    // Canonical keys sort after legacy ones here so that they win when both exist.
    const ordered = [...rows].sort((a, b) => 
        Number(a.key.startsWith('guild:')) - Number(b.key.startsWith('guild:')) +
        (a.key.startsWith('guild:') && b.key.startsWith('guild:') ? (a.key.startsWith('guild:self_role:') ? 1 : -1) : 0)
    );
    for (const row of ordered) {
        const messageId = row.key.slice(row.key.lastIndexOf(':') + 1);
        const panel = decodePanel(row.value, guildId, messageId);
        if (!panel) {
            rejected += 1;
            continue;
        }
        byMessage.set(messageId, panel);
    }
    const panels = [...byMessage.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.messageId.localeCompare(b.messageId));
    return { panels, rejected };
}

const SELECT = `SELECT key, value FROM ${table} WHERE (key LIKE $1 OR key LIKE $2 OR key LIKE $3) AND (expires_at IS NULL OR expires_at > NOW())`;

/** Every stored panel of the guild. `rejected` counts rows this code cannot read. Throws on a database error. */
const unavailable = () => fail('Database unavailable for self-role panels', 'REACTROLES_UNAVAILABLE');

/**
 * What a mutation asked for, checked against the panels that exist. Returns the keys to
 * delete and the panels to store, or null when nothing is to be written.
 */
function planChange(panels, out, guildId) {
    if (!out || typeof out !== 'object' || typeof out.then === 'function') throw fail('Invalid panel mutation result', 'REACTROLES_INVALID');
    if (out.write === false) return null;
    const remove = [...new Set(out.remove ?? [])];
    const put = out.put ?? [];
    if (remove.some((id) => !isSnowflake(id))) throw fail('Invalid message id', 'REACTROLES_INVALID');
    const after = new Map(panels.map((panel) => [panel.messageId, panel]));
    for (const id of remove) after.delete(id);
    for (const entry of put) {
        const panel = decodePanel(entry, guildId, entry?.messageId);
        if (!panel || panel.items.length === 0) throw fail('Refusing to store an invalid panel', 'REACTROLES_INVALID');
        after.set(panel.messageId, panel);
    }
    if (after.size > MAX_PANELS && after.size > panels.length) throw fail('Panel limit reached', 'REACTROLES_LIMIT', { limit: MAX_PANELS });
    return { remove, store: put.map((entry) => after.get(entry.messageId)) };
}

function mutateOnSQLite(sqlite, guildId, mutate) {
    return changeRows(sqlite, (rows) => {
        const { panels } = decodeRows(rows.rows(canonicalPrefix(guildId), legacyReactionPrefix(guildId), legacyLegacyPrefix(guildId)), guildId);
        const out = mutate(panels.map((panel) => ({ ...panel, items: [...panel.items] })));
        const plan = planChange(panels, out, guildId);
        if (plan) {
            for (const id of plan.remove) rows.del(panelKey(guildId, id), legacyReactionKey(guildId, id), legacyLegacyKey(guildId, id));
            for (const panel of plan.store) {
                rows.put(panelKey(guildId, panel.messageId), panel);
                rows.del(legacyReactionKey(guildId, panel.messageId));
                rows.del(legacyLegacyKey(guildId, panel.messageId));
            }
        }
        return out.result;
    });
}

export async function readPanels(client, guildId) {
    assertGuild(guildId);
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) return decodeRows(readPrefixes(sqlite, canonicalPrefix(guildId), legacyReactionPrefix(guildId), legacyLegacyPrefix(guildId)), guildId);
    const pool = panelPool(client);
    const result = await pool.query(SELECT, [like(canonicalPrefix(guildId)), like(legacyReactionPrefix(guildId)), like(legacyLegacyPrefix(guildId))]);
    return decodeRows(result.rows, guildId);
}

/** One stored panel or `null`. Throws on a database error. */
export async function readPanel(client, guildId, messageId) {
    assertGuild(guildId);
    if (!isSnowflake(messageId)) return null;
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) {
        const rows = [...readRows(sqlite, [panelKey(guildId, messageId), legacyReactionKey(guildId, messageId), legacyLegacyKey(guildId, messageId)])].map(([key, value]) => ({ key, value }));
        return decodeRows(rows, guildId).panels[0] ?? null;
    }
    const pool = panelPool(client);
    const result = await pool.query(
        `SELECT key, value FROM ${table} WHERE key = ANY($1::text[]) AND (expires_at IS NULL OR expires_at > NOW())`,
        [[panelKey(guildId, messageId), legacyReactionKey(guildId, messageId), legacyLegacyKey(guildId, messageId)]],
    );
    return decodeRows(result.rows, guildId).panels[0] ?? null;
}

/**
 * Change the guild's panels inside one transaction.
 *
 * `mutate(panels)` must be synchronous and free of Discord or network effects. It returns
 * `{put: [panel…], remove: [messageId…], result}` to write, or `{write: false, result}` to
 * leave everything untouched. Anything it throws rolls the transaction back and is passed on.
 * Rows this code cannot read are never touched.
 */
export async function mutatePanels(client, guildId, mutate) {
    assertGuild(guildId);
    if (typeof mutate !== 'function' || mutate.constructor?.name === 'AsyncFunction') {
        throw fail('Panel mutation must be synchronous', 'REACTROLES_INVALID');
    }
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) return mutateOnSQLite(sqlite, guildId, mutate);
    const pool = panelPool(client);
    const conn = await pool.connect();
    try {
        await conn.query('BEGIN');
        // One writer per guild: the panel limit counts rows, so a row lock alone would not hold it.
        await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zentix:self_role:${guildId}`]);
        const rows = await conn.query(`${SELECT} FOR UPDATE`, [like(canonicalPrefix(guildId)), like(legacyReactionPrefix(guildId)), like(legacyLegacyPrefix(guildId))]);
        const { panels } = decodeRows(rows.rows, guildId);

        const out = mutate(panels.map((panel) => ({ ...panel, items: [...panel.items] })));
        const plan = planChange(panels, out, guildId);
        if (!plan) {
            await conn.query('ROLLBACK');
            return out.result;
        }

        for (const id of plan.remove) {
            await conn.query(`DELETE FROM ${table} WHERE key = ANY($1::text[])`, [[panelKey(guildId, id), legacyReactionKey(guildId, id), legacyLegacyKey(guildId, id)]]);
        }
        for (const panel of plan.store) {
            await conn.query(
                `INSERT INTO ${table} (key, value, expires_at) VALUES ($1, $2::jsonb, NULL)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL`,
                [panelKey(guildId, panel.messageId), JSON.stringify(panel)],
            );
            await conn.query(`DELETE FROM ${table} WHERE key = $1`, [legacyReactionKey(guildId, panel.messageId)]);
            await conn.query(`DELETE FROM ${table} WHERE key = $1`, [legacyLegacyKey(guildId, panel.messageId)]);
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
// ---- banner assets ----------------------------------------------------------------
//
// An uploaded panel banner is kept as bytes under `guild:{guildId}:self_role_banner:{panelId}`,
// keyed by the panel's stable id (never the message id, which changes on repost). The panel
// record only carries the `attachment://` reference, so listing panels stays cheap.

const bannerPrefix = (guildId) => `guild:${guildId}:self_role_banner:`;
export const bannerKey = (guildId, panelId) => `${bannerPrefix(guildId)}${panelId}`;

/** A stored banner asset, or null when it cannot be read. */
export function parseBannerAsset(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return null; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { filename, mime, base64 } = value;
    if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(filename)) return null;
    if (bannerExtension(mime) === null) return null;
    if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_BANNER_BYTES / 3) * 4 + 8) return null;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BANNER_BYTES) return null;
    return { filename, mime, base64, buffer };
}

/** The stored banner of a panel, or null. Throws on a database error. */
export async function readBannerAsset(client, guildId, panelId) {
    assertGuild(guildId);
    if (!isPanelId(panelId)) return null;
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) return parseBannerAsset(readRow(sqlite, bannerKey(guildId, panelId)));
    const pool = panelPool(client);
    const result = await pool.query(
        `SELECT value FROM ${table} WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
        [bannerKey(guildId, panelId)],
    );
    return parseBannerAsset(result.rows[0]?.value);
}

/** Store the banner bytes. Throws on a database error. */
export async function writeBannerAsset(client, guildId, panelId, asset) {
    assertGuild(guildId);
    if (!isPanelId(panelId)) throw fail('Invalid panel id', 'REACTROLES_INVALID');
    const parsed = parseBannerAsset(asset);
    if (!parsed) throw fail('Invalid banner asset', 'REACTROLES_INVALID');
    const row = { filename: parsed.filename, mime: parsed.mime, base64: parsed.base64 };
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) {
        changeRows(sqlite, (rows) => {
            rows.put(bannerKey(guildId, panelId), row, null);
            return true;
        });
        return true;
    }
    const pool = panelPool(client);
    await pool.query(
        `INSERT INTO ${table} (key, value, expires_at) VALUES ($1, $2::jsonb, NULL)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL`,
        [bannerKey(guildId, panelId), JSON.stringify(row)],
    );
    return true;
}

/** Drop the banner bytes. Best effort on SQLite/PG alike; throws only on a database error. */
export async function deleteBannerAsset(client, guildId, panelId) {
    assertGuild(guildId);
    if (!isPanelId(panelId)) return false;
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) {
        changeRows(sqlite, (rows) => {
            rows.del(bannerKey(guildId, panelId));
            return true;
        });
        return true;
    }
    const pool = panelPool(client);
    await pool.query(`DELETE FROM ${table} WHERE key = $1`, [bannerKey(guildId, panelId)]);
    return true;
}

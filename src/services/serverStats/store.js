// store.js — the stored list of server stats counters, read and written directly on PostgreSQL.
//
// The generic key-value layer answers a failed read with "no data" and a failed
// write with `false`. For counters that meant: a short database problem during
// `/serverstats create` replaced the whole list with the one new counter, and a
// save that failed was still reported as done. Here every failure is thrown,
// and a change is one transaction that holds the row lock from read to write.

import { createHash } from 'node:crypto';
import { pgConfig } from '../../config/database/postgres.js';
import { sqliteFor, readRow, changeRows } from '../storage/sqliteRows.js';
import { DEFAULT_NOTATION, notationOrDefault } from './notation.js';
import { validateGameBinding, validateSocialBinding } from './external.js';

const tables = pgConfig.tables;
const SNOWFLAKE = /^\d{17,20}$/;
const COUNTER_ID = /^[A-Za-z0-9_-]{1,32}$/;

// One counter per type, plus the bound kinds that carry their own binding: `role` (one per chosen role)
// and `goal` (one per chosen stat+target pair), each capped separately. The names come from
// serverstatsService.COUNTER_TYPE_CONFIG; keep the two in step — tests/restricted-style parity is asserted in postgres-serverstats.test.js.
export const COUNTER_TYPES = [
    'members', 'members_only', 'bots', 'pending', 'norole',
    'channels', 'text_channels', 'voice_channels', 'announcement_channels', 'forum_channels', 'stage_channels', 'categories',
    'roles', 'emojis', 'static_emojis', 'animated_emojis', 'stickers',
    'boosts', 'boost_tier', 'bans', 'role', 'goal',
    'connected', 'online', 'idle', 'dnd', 'offline', 'streaming',
    'game', 'social',
];
/** The stats a goal counter may track: every regular type. (`role` needs its own binding and is not a goal stat.) */
export const GOAL_STATS = COUNTER_TYPES.filter((type) => type !== 'role' && type !== 'goal' && type !== 'game' && type !== 'social');
/** The status counter types: they read the gateway presence cache, never the member list. */
export const PRESENCE_TYPES = new Set(['connected', 'online', 'idle', 'dnd', 'offline', 'streaming']);
/** The highest target a goal counter may carry: whole numbers, 1..2 billion, far above any Discord stat. */
export const MAX_GOAL = 2_000_000_000;
/** A server may have at most this many role counters (one per chosen role), on top of one per regular type. */
export const MAX_ROLE_COUNTERS = 10;
/** A server may have at most this many goal counters (one per chosen stat+target pair), on top of the rest. */
export const MAX_GOAL_COUNTERS = 10;
/** A server may have at most this many game counters (one per chosen game/server), on top of the rest. */
export const MAX_GAME_COUNTERS = 10;
/** A server may have at most this many social counters (one per chosen account), on top of the rest. */
export const MAX_SOCIAL_COUNTERS = 10;
/** One counter per regular type, plus one per chosen role, goal, game and social. */
export const MAX_COUNTERS = (COUNTER_TYPES.length - 4) + MAX_ROLE_COUNTERS + MAX_GOAL_COUNTERS + MAX_GAME_COUNTERS + MAX_SOCIAL_COUNTERS;

export const fail = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** The PostgreSQL pool. Throws SERVERSTATS_UNAVAILABLE when PostgreSQL cannot be used right now. */
export function counterPool(client) {
    const db = client?.db;
    const status = db?.getStatus?.();
    if (status?.connectionType !== 'postgresql' || status.isDegraded || !db.isAvailable?.()
        || !db.db?.isAvailable?.() || typeof db.db.pool?.connect !== 'function') {
        throw fail('PostgreSQL unavailable for server stats counters', 'SERVERSTATS_UNAVAILABLE');
    }
    return db.db.pool;
}

function isCounterShape(entry) {
    if (!(entry && typeof entry === 'object' && !Array.isArray(entry)
        && typeof entry.id === 'string' && COUNTER_ID.test(entry.id)
        && typeof entry.type === 'string' && entry.type.length > 0 && entry.type.length <= 32
        && typeof entry.channelId === 'string' && SNOWFLAKE.test(entry.channelId))) {
        return false;
    }
    // A role counter is only usable with a valid role id; a goal counter with a valid stat and target.
    if (entry.type === 'role') return typeof entry.roleId === 'string' && SNOWFLAKE.test(entry.roleId);
    if (entry.type === 'goal') {
        return typeof entry.goalStat === 'string' && GOAL_STATS.includes(entry.goalStat)
            && Number.isSafeInteger(entry.goal) && entry.goal >= 1 && entry.goal <= MAX_GOAL;
    }
    // Game and social counters carry a provider+target binding; an invalid one makes the entry unusable.
    if (entry.type === 'game') return validateGameBinding(entry.game) !== null;
    if (entry.type === 'social') return validateSocialBinding(entry.social) !== null;
    return true;
}

function normalize(entry, guildId) {
    const counter = {
        id: entry.id,
        type: entry.type,
        channelId: entry.channelId,
        guildId,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
        enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
    };
    if (typeof entry.updatedAt === 'string') counter.updatedAt = entry.updatedAt;
    // A role binding only means something for the role type; it is dropped anywhere else.
    if (entry.type === 'role') counter.roleId = entry.roleId;
    // A goal binding only means something for the goal type; it is dropped anywhere else.
    if (entry.type === 'goal') {
        counter.goalStat = entry.goalStat;
        counter.goal = entry.goal;
    }
    // A game binding only means something for the game type; a social binding for the social type.
    if (entry.type === 'game') counter.game = validateGameBinding(entry.game);
    if (entry.type === 'social') counter.social = validateSocialBinding(entry.social);
    return counter;
}

/**
 * The stored column as a list of counters and the notation of its numbers.
 * The column is `{ counters: [...], notation: '...' }`; a bare list (as older versions wrote it) is read as-is.
 * A notation this version does not know is treated as the default; it is a cosmetic choice, not data.
 * Entries that cannot be used (no id, type or channel) are left out and counted. A value that is neither a list
 * nor a wrapper with one is refused: writing over something this code does not understand would destroy it.
 */
export function decodeCounters(raw, guildId) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            throw fail('Stored counters are not valid JSON', 'SERVERSTATS_INVALID');
        }
    }
    let notation = DEFAULT_NOTATION;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !isCounterShape(value)
        && Array.isArray(value.counters)) {
        notation = notationOrDefault(value.notation);
        value = value.counters;
    }
    if (value === null || value === undefined) return { counters: [], rejected: 0, notation };
    // A single counter stored without its list, as an older version wrote it.
    if (isCounterShape(value)) value = [value];
    if (!Array.isArray(value)) throw fail('Stored counters are not a list', 'SERVERSTATS_INVALID');

    const counters = [];
    const seen = new Set();
    let rejected = 0;
    for (const entry of value) {
        if (!isCounterShape(entry) || seen.has(entry.id)) {
            rejected += 1;
            continue;
        }
        seen.add(entry.id);
        counters.push(normalize(entry, guildId));
    }
    return { counters, rejected, notation };
}

/** A content hash of the list. Not a version number: A→B→A is not detected. */
export function revisionOf(counters) {
    const canonical = counters.map((c) => [c.id, c.type, c.channelId, c.roleId ?? null, c.goalStat ?? null, c.goal ?? null, c.game ? validateGameBinding(c.game) : null, c.social ? validateSocialBinding(c.social) : null, c.enabled, c.createdAt, c.updatedAt ?? null]);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function assertGuild(guildId) {
    if (!SNOWFLAKE.test(guildId || '')) throw fail('Invalid guild id', 'SERVERSTATS_INVALID');
}

/** The stored counters with their revision. Throws on a database error. */
const unavailable = () => fail('Database unavailable for server stats counters', 'SERVERSTATS_UNAVAILABLE');
/** On SQLite the counters of a guild are one row; on PostgreSQL they are a column of the guild row. */
const countersKey = (guildId) => `guild:${guildId}:counters`;

function mutateOnSQLite(sqlite, guildId, mutate) {
    return changeRows(sqlite, (rows) => {
        const stored = decodeCounters(rows.get(countersKey(guildId)) ?? null, guildId);
        const { counters } = stored;
        const out = mutate(counters.map((counter) => ({ ...counter })), revisionOf(counters));
        if (!out || typeof out !== 'object' || typeof out.then === 'function') throw fail('Invalid counter mutation result', 'SERVERSTATS_INVALID');
        if (out.write === false) return out.result;
        const decoded = decodeCounters(out.counters, guildId);
        if (decoded.rejected > 0 || decoded.counters.length > MAX_COUNTERS) throw fail('Refusing to store an invalid counter list', 'SERVERSTATS_INVALID');
        rows.put(countersKey(guildId), { counters: decoded.counters, notation: notationOrDefault(out.notation ?? stored.notation) });
        return out.result;
    });
}

export async function readCounters(client, guildId) {
    assertGuild(guildId);
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) {
        const { counters, rejected, notation } = decodeCounters(readRow(sqlite, countersKey(guildId)) ?? null, guildId);
        return { counters, rejected, revision: revisionOf(counters), notation };
    }
    const pool = counterPool(client);
    const result = await pool.query(`SELECT counters FROM ${tables.guilds} WHERE id = $1`, [guildId]);
    const { counters, rejected, notation } = decodeCounters(result.rows[0]?.counters ?? null, guildId);
    return { counters, rejected, revision: revisionOf(counters), notation };
}

/**
 * Change the list inside one transaction.
 *
 * `mutate(counters, revision)` must be synchronous and free of Discord or network effects. It returns
 * `{counters, result}` to store a new list, or `{write: false, result}` to leave the stored value untouched.
 * Anything it throws rolls the transaction back and is passed on.
 */
export async function mutateCounters(client, guildId, mutate) {
    assertGuild(guildId);
    if (typeof mutate !== 'function' || mutate.constructor?.name === 'AsyncFunction') {
        throw fail('Counter mutation must be synchronous', 'SERVERSTATS_INVALID');
    }
    const sqlite = sqliteFor(client, unavailable);
    if (sqlite) return mutateOnSQLite(sqlite, guildId, mutate);
    const pool = counterPool(client);
    const conn = await pool.connect();
    try {
        await conn.query('BEGIN');
        await conn.query(`INSERT INTO ${tables.guilds} (id, created_at) VALUES ($1, CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING`, [guildId]);
        const rows = await conn.query(`SELECT counters FROM ${tables.guilds} WHERE id = $1 FOR UPDATE`, [guildId]);
        if (!rows.rows.length) throw fail('Guild row unavailable', 'SERVERSTATS_UNAVAILABLE');

        const stored = decodeCounters(rows.rows[0].counters, guildId);
        const { counters } = stored;
        const out = mutate(counters.map((counter) => ({ ...counter })), revisionOf(counters));
        if (!out || typeof out !== 'object' || typeof out.then === 'function') throw fail('Invalid counter mutation result', 'SERVERSTATS_INVALID');

        if (out.write === false) {
            await conn.query('ROLLBACK');
            return out.result;
        }

        const decoded = decodeCounters(out.counters, guildId);
        if (decoded.rejected > 0 || decoded.counters.length > MAX_COUNTERS) throw fail('Refusing to store an invalid counter list', 'SERVERSTATS_INVALID');
        const notation = notationOrDefault(out.notation ?? stored.notation);
        await conn.query(
            `UPDATE ${tables.guilds} SET counters = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [guildId, JSON.stringify({ counters: decoded.counters, notation })],
        );
        await conn.query('COMMIT');
        return out.result;
    } catch (error) {
        await conn.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        conn.release();
    }
}

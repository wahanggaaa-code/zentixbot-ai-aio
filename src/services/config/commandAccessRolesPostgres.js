// commandAccessRolesPostgres.js — persistent store for the guild's
// `commandAccessRoleIds` setting: the list of roles whose members may run the
// restricted commands (owner bot always may). An empty list means owner bot only.
//
// Same storage layout and revision semantics as commandAccessPostgres.js:
// PostgreSQL guilds.config JSONB object patched with jsonb_set, SQLite single
// `guild:<id>:config` row as fallback, revision = sha256 of the stored JSON text.

import { pgConfig } from '../../config/database/postgres.js';
import { assertOnboardingShape, assertOnboardingCompatible } from './onboardingConflict.js';
import { sqliteFor } from '../storage/sqliteRows.js';
import { commandAccessVersion } from './commandAccessPostgres.js';
import { normalizeRoleIdList } from '../../utils/restrictedCommands.js';

const tables = pgConfig.tables;
const fail = (message, code = 'COMMAND_ACCESS_ROLES_INVALID') => Object.assign(new Error(message), { code });
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const MAX_ACCESS_ROLES = 25;

export function checkAccessRolesConfig(raw) {
  if (raw !== undefined && raw !== null && !obj(raw)) throw fail('Invalid guild config');
  const list = raw?.commandAccessRoleIds;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > MAX_ACCESS_ROLES) throw fail('Invalid command access roles');
  return normalizeRoleIdList(list, MAX_ACCESS_ROLES);
}

const getPool = (client) => {
  const db = client?.db, s = db?.getStatus?.();
  if (s?.connectionType !== 'postgresql' || s.isDegraded || !db.isAvailable?.() || !db.db?.isAvailable?.() || !db.db.pool?.connect) {
    throw fail('PostgreSQL unavailable', 'COMMAND_ACCESS_ROLES_UNAVAILABLE');
  }
  return db.db.pool;
};
const unavailable = () => fail('Database unavailable', 'COMMAND_ACCESS_ROLES_UNAVAILABLE');
const configKey = (guild) => `guild:${guild}:config`, welcomeKey = (guild) => `guild:${guild}:welcome`;
const sqliteRevision = (raw) => (raw === null ? 'missing' : commandAccessVersion(JSON.stringify(raw)));

function mutateSQLiteAccessRoles(sqlite, guild, { roleIds, revision }) {
  return sqlite.transaction((tx) => {
    const raw = tx.botGet(configKey(guild)), config = raw ?? {}, current = checkAccessRolesConfig(config);
    if (revision !== undefined && sqliteRevision(raw) !== revision) throw fail('Command settings changed', 'COMMAND_ACCESS_ROLES_STALE');
    const welcome = tx.botGet(welcomeKey(guild)) ?? {};
    assertOnboardingShape(config, welcome);
    assertOnboardingCompatible(config, welcome);
    const next = { ...config, commandAccessRoleIds: [...roleIds] };
    tx.botSet(configKey(guild), next);
    return { roleIds: [...roleIds], revision: sqliteRevision(next) };
  });
}

export async function readPostgresCommandAccessRoles(client, guild) {
  const sqlite = sqliteFor(client, unavailable);
  if (sqlite) {
    const stored = sqlite.botGet(configKey(guild));
    return { roleIds: checkAccessRolesConfig(stored ?? {}), revision: sqliteRevision(stored) };
  }
  const result = await getPool(client).query(`SELECT config,config::text AS serialized FROM ${tables.guilds} WHERE id=$1`, [guild]);
  const row = result.rows[0];
  return {
    roleIds: checkAccessRolesConfig(row?.config ?? {}),
    revision: row ? commandAccessVersion(row.serialized) : 'missing',
  };
}

// Participating config writers share guild -> welcome row-lock order. Only the
// access roles array is replaced so unknown JSONB values retain exact representation.
export async function mutatePostgresCommandAccessRoles(client, guild, { roleIds, revision }) {
  if (!Array.isArray(roleIds) || roleIds.length > MAX_ACCESS_ROLES) throw fail('Invalid mutation');
  const normalized = normalizeRoleIdList(roleIds, MAX_ACCESS_ROLES);
  if (normalized.length !== roleIds.length) throw fail('Invalid role list');
  if (revision !== undefined && !/^(missing|[0-9a-f]{64})$/.test(revision)) throw fail('Invalid mutation');

  const sqlite = sqliteFor(client, unavailable);
  if (sqlite) return mutateSQLiteAccessRoles(sqlite, guild, { roleIds: normalized, revision });

  const p = getPool(client), conn = await p.connect();
  try {
    await conn.query('BEGIN');
    const created = await conn.query(`INSERT INTO ${tables.guilds}(id) VALUES($1) ON CONFLICT(id) DO NOTHING RETURNING id`, [guild]);
    const row = (await conn.query(`SELECT config,config::text AS serialized FROM ${tables.guilds} WHERE id=$1 FOR UPDATE`, [guild])).rows[0];
    const actual = created.rowCount ? 'missing' : commandAccessVersion(row.serialized);
    if (revision !== undefined && actual !== revision) throw fail('Command settings changed', 'COMMAND_ACCESS_ROLES_STALE');
    const welcomeResult = await conn.query(`SELECT config FROM ${tables.welcome_configs} WHERE guild_id=$1 FOR UPDATE`, [guild]);
    const welcome = welcomeResult.rows.length ? welcomeResult.rows[0].config : {};
    assertOnboardingShape(row.config, welcome);
    assertOnboardingCompatible(row.config, welcome);
    const saved = await conn.query(`UPDATE ${tables.guilds} SET config=jsonb_set(config,ARRAY['commandAccessRoleIds'::text],$2::jsonb,true),updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING config::text AS serialized`, [guild, JSON.stringify(normalized)]);
    await conn.query('COMMIT');
    return { roleIds: normalized, revision: commandAccessVersion(saved.rows[0].serialized) };
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

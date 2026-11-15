#!/usr/bin/env node
/**
 * Remove what is left of the counting game ("Permainan hitung") after the feature
 * was removed from the bot. One key-value row per server, `countingGame:{guildId}`,
 * in `temp_data` (PostgreSQL) or in the SQLite file behind `zentix_bot_kv`.
 *
 * Usage:
 *   node scripts/cleanup-counting-game.js           dry-run: show what would be removed
 *   node scripts/cleanup-counting-game.js --apply   delete the rows
 *
 * The engine is chosen exactly the way the bot chooses it (DATABASE_ENGINE /
 * DATABASE_PATH / POSTGRES_* from .env). Stop the bot before running --apply, or
 * accept that it sees the rows disappear. Run this only on the server that holds
 * the real data.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const apply = process.argv.includes('--apply');

const report = (keys, applying) => {
    if (keys.length === 0) {
        console.log('cleanup-counting-game: nothing to remove; no countingGame:* rows found.');
        return;
    }
    console.log(`cleanup-counting-game: ${keys.length} countingGame:* row(s) ${applying ? 'about to be' : 'would be'} removed:`);
    for (const key of keys) console.log(`  - ${key}`);
    if (!applying) console.log('cleanup-counting-game: dry-run only, nothing was deleted. Re-run with --apply to delete.');
};

async function main() {
    const { chooseDatabase } = await import('../src/config/database/engine.js');
    const choice = chooseDatabase(process.env);

    if (choice.engine === 'postgresql') {
        const { default: pg } = await import('pg');
        const { resolvePostgresPoolConfig, pgConfig } = await import('../src/config/database/postgres.js');
        const table = pgConfig.tables.temp_data;
        if (!/^[a-z_][a-z0-9_]*$/.test(String(table))) throw new Error('Unsafe temp_data table name in configuration');
        const pool = new pg.Pool(resolvePostgresPoolConfig());
        const client = await pool.connect();
        try {
            const before = await client.query(`SELECT key FROM ${table} WHERE starts_with(key, 'countingGame:') ORDER BY key`);
            report(before.rows.map((row) => row.key), apply);
            if (!apply || before.rows.length === 0) return;
            await client.query('BEGIN');
            try {
                const gone = await client.query(`DELETE FROM ${table} WHERE starts_with(key, 'countingGame:')`);
                await client.query('COMMIT');
                console.log(`cleanup-counting-game: deleted ${gone.rowCount} row(s).`);
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            }
        } finally {
            client.release();
            await pool.end();
        }
        return;
    }

    if (!existsSync(choice.path)) throw new Error(`SQLite file not found: ${choice.path}`);
    const { openSQLiteStore } = await import('../src/services/storage/sqlite.js');
    const sqlite = await openSQLiteStore({ path: choice.path, busyTimeout: 5000 });
    try {
        const rows = sqlite.botRows('countingGame:');
        report(rows.map((row) => row.key), apply);
        if (!apply || rows.length === 0) return;
        sqlite.transaction((tx) => {
            for (const row of rows) tx.botDelete(row.key);
        });
        const left = sqlite.botRows('countingGame:');
        if (left.length) throw new Error(`cleanup-counting-game: ${left.length} row(s) remain after deletion`);
        console.log(`cleanup-counting-game: deleted ${rows.length} row(s).`);
    } finally {
        if (sqlite.isOpen()) sqlite.close();
    }
}

main().catch((error) => {
    console.error('cleanup-counting-game failed:', error);
    process.exit(1);
});

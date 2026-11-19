// Persistent queue for explicitly scheduled text messages, not arbitrary flow continuations.
// One atomic KV value per guild ensures claims are exclusive on SQLite and PostgreSQL.
// A lost lease becomes uncertain, never eligible for automatic retry: Discord side effects
// may have succeeded even when a worker died before recording success.
import crypto from 'node:crypto';

const MAX_JOBS = 100;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);
const fail = message => Object.assign(new Error(message), { status: 400, code: 'MESSAGE_STUDIO_QUEUE_INVALID' });

export function createStudioDurableQueue({ kv, guildId, now = Date.now, makeToken = () => crypto.randomBytes(16).toString('hex'), leaseMs = 60000 }) {
    if (!kv || typeof kv.update !== 'function' || !snowflake(guildId) || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) throw fail('Konfigurasi antrean tidak valid.');
    const key = `message-studio:v1:durable:${guildId}`;
    const state = current => {
        if (current === null) return { version: 1, jobs: [] };
        if (!current || current.version !== 1 || !Array.isArray(current.jobs) || current.jobs.length > MAX_JOBS) throw fail('Data antrean tidak valid.');
        return current;
    };
    // No interaction tokens, arbitrary Discord targets, or runtime closures are stored.
    const cleanPayload = payload => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['channelId', 'message'].includes(k)) || !snowflake(payload.channelId) || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 4000 || payload.message.includes('\0')) throw fail('Isi pekerjaan tidak valid.');
        return { channelId: payload.channelId, message: payload.message };
    };
    async function schedule({ id, runAt, payload }) {
        const timestamp = now();
        if (!safeId(id) || !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(runAt) || runAt < timestamp || runAt > timestamp + MAX_DELAY_MS) throw fail('Jadwal tidak valid.');
        const data = cleanPayload(payload);
        await kv.update(key, current => {
            const queue = state(current);
            // Never automatically prune pending, running, or uncertain work.
            queue.jobs = queue.jobs.filter(job => !(['done', 'failed'].includes(job.status) && Number.isFinite(job.finishedAt) && job.finishedAt <= timestamp - RETENTION_MS));
            if (queue.jobs.some(job => job.id === id)) throw fail('ID pekerjaan sudah ada.');
            if (queue.jobs.length >= MAX_JOBS) throw fail('Antrean penuh; pekerjaan perlu ditinjau.');
            queue.jobs.push({ id, runAt, payload: data, status: 'pending', createdAt: timestamp });
            return queue;
        });
    }
    async function claim() {
        const timestamp = now(), token = makeToken();
        if (!safeId(token) || !Number.isSafeInteger(timestamp)) throw fail('Klaim tidak valid.');
        let claimed = null;
        await kv.update(key, current => {
            const queue = state(current);
            for (const job of queue.jobs) if (job.status === 'running' && job.leaseUntil <= timestamp) { job.status = 'uncertain'; delete job.token; delete job.leaseUntil; job.finishedAt = timestamp; }
            const job = queue.jobs.filter(j => j.status === 'pending' && j.runAt <= timestamp).sort((a, b) => a.runAt - b.runAt || a.createdAt - b.createdAt)[0];
            if (job) { job.status = 'running'; job.token = token; job.leaseUntil = timestamp + leaseMs; claimed = structuredClone(job); }
            return queue;
        });
        return claimed;
    }
    async function finish(id, token, outcome) {
        if (!safeId(id) || !safeId(token) || !['done', 'failed', 'uncertain'].includes(outcome)) throw fail('Hasil pekerjaan tidak valid.');
        const timestamp = now(); let updated = false;
        await kv.update(key, current => {
            const queue = state(current), job = queue.jobs.find(j => j.id === id);
            if (!job || job.status !== 'running' || job.token !== token) return undefined;
            // Expired workers cannot report success after another observer marks an uncertain outcome.
            job.status = job.leaseUntil <= timestamp ? 'uncertain' : outcome;
            job.finishedAt = timestamp; delete job.token; delete job.leaseUntil; updated = true;
            return queue;
        });
        return updated;
    }
    async function list() {
        const queue = state(await kv.get(key));
        return queue.jobs.map(({ token, ...job }) => structuredClone(job));
    }
    async function remove(id) {
        if (!safeId(id)) throw fail('ID pekerjaan tidak valid.');
        let removed = false;
        await kv.update(key, current => {
            const queue = state(current), job = queue.jobs.find(j => j.id === id);
            if (!job || job.status === 'running') return undefined;
            queue.jobs = queue.jobs.filter(j => j.id !== id); removed = true; return queue;
        });
        return removed;
    }
    return { schedule, claim, finish, list, remove };
}

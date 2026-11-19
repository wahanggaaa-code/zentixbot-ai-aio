// Persistent queue for scheduled text and validated, token-free flow continuations.
// One atomic KV value per guild ensures claims are exclusive on SQLite and PostgreSQL.
// A lost lease becomes uncertain, never eligible for automatic retry: Discord side effects
// may have succeeded even when a worker died before recording success.
import crypto from 'node:crypto';
import { normalizeStudioCheckpoint, normalizeStudioFlow, supportsDurableStudioFlow } from './messageStudioFlow.js';

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
    const cleanFlow = payload => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['userId','rootId','depth','snapshot','followingFlows'].includes(k)) || !snowflake(payload.userId) || !safeId(payload.rootId) || (payload.depth !== undefined && (!Number.isInteger(payload.depth) || payload.depth < 0 || payload.depth > 3))) throw fail('Isi kelanjutan flow tidak valid.');
        const snapshot = normalizeStudioCheckpoint(payload.snapshot);
        const next = payload.followingFlows ?? [];
        if (!Array.isArray(next) || next.length > 5 || next.some(flow => !supportsDurableStudioFlow(flow))) throw fail('Flow berikutnya tidak valid.');
        const followingFlows = next.map(normalizeStudioFlow);
        normalizeStudioFlow([...snapshot.remaining, ...followingFlows.flat()]); // Combined work remains bounded.
        return { userId: payload.userId, rootId: payload.rootId, depth: payload.depth ?? 0, snapshot, followingFlows };

    };
    async function schedule({ id, runAt, payload, kind = 'message' }) {
        const timestamp = now();
        if (!safeId(id) || !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(runAt) || runAt < timestamp || runAt > timestamp + MAX_DELAY_MS) throw fail('Jadwal tidak valid.');
        if (!['message','flow'].includes(kind)) throw fail('Jenis pekerjaan tidak valid.');
        const data = kind === 'flow' ? cleanFlow(payload) : cleanPayload(payload);
        await kv.update(key, current => {
            const queue = state(current);
            // Never automatically prune pending, running, or uncertain work.
            queue.jobs = queue.jobs.filter(job => !(['done', 'failed'].includes(job.status) && Number.isFinite(job.finishedAt) && job.finishedAt <= timestamp - RETENTION_MS));
            if (queue.jobs.some(job => job.id === id)) throw fail('ID pekerjaan sudah ada.');
            if (queue.jobs.length >= MAX_JOBS) throw fail('Antrean penuh; pekerjaan perlu ditinjau.');
            queue.jobs.push({ id, runAt, payload: data, ...(kind === 'flow' ? {kind} : {}), status: 'pending', createdAt: timestamp });
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
    // Persist the next checkpoint on the same claim. An expired/ambiguous claim
    // is never made pending again, preventing automatic replay of side effects.
    async function suspend(id, token, runAt, payload) {
        const timestamp = now(), data = cleanFlow(payload); let updated = false;
        if (!safeId(id) || !safeId(token) || !Number.isSafeInteger(runAt) || runAt < timestamp || runAt > timestamp + MAX_DELAY_MS) throw fail('Jadwal kelanjutan tidak valid.');
        await kv.update(key, current => {
            const queue = state(current), job = queue.jobs.find(j => j.id === id);
            if (!job || job.kind !== 'flow' || job.status !== 'running' || job.token !== token || job.leaseUntil <= timestamp) return undefined;
            job.payload = data; job.runAt = runAt; job.status = 'pending'; delete job.token; delete job.leaseUntil; updated = true; return queue;
        });
        return updated;
    }
    async function finish(id, token, outcome) {
        if (!safeId(id) || !safeId(token) || !['done', 'failed', 'uncertain'].includes(outcome)) throw fail('Hasil pekerjaan tidak valid.');
        const timestamp = now(); let updated = false;
        await kv.update(key, current => {
            const queue = state(current), job = queue.jobs.find(j => j.id === id);
            if (!job || job.status !== 'running' || job.token !== token) return undefined;
            // Expired workers cannot report success after another observer marks an uncertain outcome.
            job.status = job.leaseUntil <= timestamp ? 'uncertain' : outcome;
            // Form fields and selected IDs are needed only while a flow may resume.
            // Retain them for uncertain jobs until reviewed; successful/failed jobs
            // keep history without retaining these submitted variable values.
            if (job.kind === 'flow' && ['done', 'failed'].includes(job.status) && job.payload?.snapshot) job.payload.snapshot.variables = {};
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
    return { schedule, claim, suspend, finish, list, remove };
}

import express from 'express';
import { createMessageStudio } from '../services/messageStudio.js';
import { importDiscordMessage } from '../services/messageStudioImport.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (body, required, optional = []) => {
    if (!isObject(body)) throw Object.assign(new Error('Permintaan tidak valid.'), { status: 400, code: 'MESSAGE_STUDIO_INVALID' });
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !Object.hasOwn(body, key)) || Object.keys(body).some((key) => !allowed.has(key))) throw Object.assign(new Error('Permintaan tidak valid.'), { status: 400, code: 'MESSAGE_STUDIO_INVALID' });
};
const bad = (message, status = 400, code = 'MESSAGE_STUDIO_INVALID') => Object.assign(new Error(message), { status, code });
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);

/** Owner-only dashboard endpoints for the standalone Components V2 Message Studio. */
export function createMessageStudioApi(client, { auth, csrf, env = process.env, studio = client.messageStudio || createMessageStudio({ client }) } = {}) {
    const router = express.Router();
    router.use(express.json({ limit: '8mb' }));
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    const owner = (req, res, next) => {
        const ids = String(env.OWNER_IDS || '').split(',').map((id) => id.trim()).filter((id) => /^\d{17,20}$/.test(id));
        if (!ids.includes(req.session?.user?.id)) return res.status(403).json({ error: 'Message Studio hanya untuk owner bot.', code: 'MESSAGE_STUDIO_OWNER' });
        next();
    };
    const fail = (res, error) => {
        const status = Number.isInteger(error?.status) ? error.status : 503;
        return res.status(status).json({
            error: error?.status ? error.message : 'Message Studio atau database tidak tersedia.',
            code: error?.code || 'MESSAGE_STUDIO_UNAVAILABLE',
            ...(error?.uncertain === true ? { uncertain: true } : {}),
        });
    };
    const noQuery = (req) => {
        if (Object.keys(req.query).length) throw bad('Parameter tidak valid.');
    };

    router.get('/', auth, owner, async (req, res) => {
        try { noQuery(req); res.json(await studio.overview(req.guild)); }
        catch (error) { fail(res, error); }
    });
    router.get('/assets/:id', auth, owner, async (req, res) => {
        try {
            noQuery(req);
            if (!validId(req.params.id)) throw bad('Gambar tidak valid.');
            const asset = await studio.asset(req.guild, req.params.id);
            if (!asset) throw bad('Gambar tidak ditemukan.', 404, 'MESSAGE_STUDIO_ASSET_MISSING');
            res.set({ 'Content-Type': asset.mime, 'Content-Disposition': `${asset.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${asset.filename}"`, 'X-Content-Type-Options': 'nosniff' }).send(asset.buffer);
        } catch (error) { fail(res, error); }
    });
    router.get('/scheduled', auth, owner, async (req, res) => {
        try { noQuery(req); res.json({ jobs: await studio.listScheduled(req.guild) }); }
        catch (error) { fail(res, error); }
    });
    router.delete('/scheduled/:id', auth, owner, csrf, async (req, res) => {
        try {
            noQuery(req); if (!validId(req.params.id)) throw bad('ID jadwal tidak valid.');
            own(req.body, ['confirmed']); if (req.body.confirmed !== true) throw bad('Konfirmasi diperlukan.');
            await studio.removeScheduled(req.guild, req.params.id); res.json({ ok: true });
        } catch (error) { fail(res, error); }
    });
    router.post('/import-discord', auth, owner, csrf, (req, res) => {
        try { noQuery(req); own(req.body, ['message']); res.json({ ok: true, ...importDiscordMessage(req.body.message) }); }
        catch (error) { fail(res, error); }
    });
    router.post('/templates', auth, owner, csrf, async (req, res) => {
        try {
            own(req.body, ['name', 'document'], ['uploads']);
            res.status(201).json({ ok: true, template: await studio.saveTemplate({ guild: req.guild, name: req.body.name, document: req.body.document, uploads: req.body.uploads }) });
        } catch (error) { fail(res, error); }
    });
    router.patch('/templates/:id', auth, owner, csrf, async (req, res) => {
        try {
            if (!validId(req.params.id)) throw bad('Template tidak valid.');
            own(req.body, ['name', 'document'], ['uploads']);
            res.json({ ok: true, template: await studio.saveTemplate({ guild: req.guild, id: req.params.id, name: req.body.name, document: req.body.document, uploads: req.body.uploads }) });
        } catch (error) { fail(res, error); }
    });
    router.delete('/templates/:id', auth, owner, csrf, async (req, res) => {
        try {
            if (!validId(req.params.id)) throw bad('Template tidak valid.');
            own(req.body, ['confirmed']); if (req.body.confirmed !== true) throw bad('Konfirmasi diperlukan.');
            res.json({ ok: true, ...await studio.deleteTemplate({ guild: req.guild, id: req.params.id }) });
        } catch (error) { fail(res, error); }
    });
    router.post('/send', auth, owner, csrf, async (req, res) => {
        try {
            own(req.body, ['confirmed', 'channelId', 'sender', 'document'], ['identity', 'uploads', 'test']);
            if (req.body.confirmed !== true) throw bad('Konfirmasi pengiriman diperlukan.');
            res.status(201).json({ ok: true, message: await studio.send({ guild: req.guild, actorId: req.session.user.id, channelId: req.body.channelId, sender: req.body.sender, identity: req.body.identity, document: req.body.document, uploads: req.body.uploads, test: req.body.test === true }) });
        } catch (error) { fail(res, error); }
    });
    router.patch('/messages/:id', auth, owner, csrf, async (req, res) => {
        try {
            if (!validId(req.params.id)) throw bad('Pesan tidak valid.');
            own(req.body, ['confirmed', 'document'], ['uploads']); if (req.body.confirmed !== true) throw bad('Konfirmasi pengubahan diperlukan.');
            res.json({ ok: true, message: await studio.edit({ guild: req.guild, actorId: req.session.user.id, id: req.params.id, document: req.body.document, uploads: req.body.uploads }) });
        } catch (error) { fail(res, error); }
    });
    router.post('/messages/:id/forget', auth, owner, csrf, async (req, res) => {
        try {
            if (!validId(req.params.id)) throw bad('Pesan tidak valid.');
            own(req.body, ['confirmed']); if (req.body.confirmed !== true) throw bad('Konfirmasi diperlukan.');
            res.json({ ok: true, ...await studio.forget({ guild: req.guild, id: req.params.id }) });
        } catch (error) { fail(res, error); }
    });
    router.delete('/messages/:id', auth, owner, csrf, async (req, res) => {
        try {
            if (!validId(req.params.id)) throw bad('Pesan tidak valid.');
            own(req.body, ['confirmed']); if (req.body.confirmed !== true) throw bad('Konfirmasi penghapusan diperlukan.');
            res.json({ ok: true, ...await studio.remove({ guild: req.guild, id: req.params.id }) });
        } catch (error) { fail(res, error); }
    });
    return router;
}

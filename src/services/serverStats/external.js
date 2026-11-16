// external.js — counters that read data outside Discord (Tahap 7: game and social families).
//
// Game counters:
//   steam     — current players of one Steam game (AppID), via the public ISteamApps endpoint. No key needed.
//   minecraft — players online on one Minecraft: Java server, via the Server List Ping protocol. No key needed.
//   fivem     — players on one FXServer, best effort over its legacy HTTP endpoints. No key needed.
// Social counters (all keys are ONE owner-wide set in .env, shared by every server — same model as the AI keys):
//   youtube   — subscribers of one channel. Needs YOUTUBE_API_KEY (YouTube Data API v3).
//   twitch    — followers of one channel. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.
//   x         — followers of one account. Needs X_BEARER_TOKEN (X API v2).
//   instagram — followers of one Instagram BUSINESS account (the id is stored on the counter). Needs INSTAGRAM_ACCESS_TOKEN.
//
// Everything that leaves this process goes through one transport so tests can replace the network:
//   setExternalTransportForTests({ fetch, ping }) — `fetch` for HTTP(S) JSON, `ping` for the Minecraft ping.
// A counter whose source cannot be read yields null — the channel keeps its current name and /check says why.
// User-supplied hosts (minecraft/fivem) are validated strictly and re-resolved at read time; a host that
// resolves to a private address is refused — a counter must not become a probe into the network.

import net from 'node:net';
import dns from 'node:dns/promises';
import { logger } from '../../utils/logger.js';

const REQUEST_MS = 8_000;
const MC_PING_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CONCURRENT = 4;
const MAX_LABEL = 30;

export const GAME_PROVIDERS = ['steam', 'minecraft', 'fivem'];
export const SOCIAL_PLATFORMS = ['youtube', 'twitch', 'x', 'instagram'];

// ---------------------------------------------------------------------------
// Config labels and validation. These also gate what the store will persist.
// ---------------------------------------------------------------------------

/** The short name written into the channel name before the number. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function sanitizeLabel(value) {
    if (typeof value !== 'string') return null;
    const clean = value.normalize('NFKC').replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > MAX_LABEL) return null;
    if (/^\d+$/.test(clean)) return null;                 // a name of digits only is indistinguishable from the count
    if (/[@#:{}\\]/.test(clean)) return null;             // keep the label out of mentions and JSON braces
    return clean;
}

export function sanitizeAppId(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) return null;
    return value;
}

export function sanitizePort(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65535) return null;
    return value;
}

/** IPv4 octets (0-255) → whether the address is public. */
function publicIPv4([a, b]) {
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;       // CGNAT
    if (a === 169 && b === 254) return false;                 // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;   // benchmarking, 198.51.100/24
    if (a === 203 && b === 0) return false;                   // 203.0.113/24
    if (a >= 224) return false;                               // multicast & reserved
    return true;
}

function publicIPv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return false;
    if (/^f[cd]/.test(lower)) return false;                   // unique-local
    if (/^fe[89ab]/.test(lower)) return false;                // link-local
    if (/^ff/.test(lower)) return false;                      // multicast
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return publicIPv4(mapped[1].split('.').map(Number));
    return true;
}

export function isPublicLiteral(host) {
    const kind = net.isIP(host);
    if (kind === 4) return publicIPv4(host.split('.').map(Number));
    if (kind === 6) return publicIPv6(host);
    return null;
}

/** Syntactic check usable synchronously; the DNS check happens at read time too. */
export function isValidGameHostSyntax(host) {
    if (typeof host !== 'string' || !host || host.length > 253) return false;
    const literal = isPublicLiteral(host);
    if (literal !== null) return literal;
    return HOSTNAME.test(host);
}

/** Validate + resolve; throws on anything private. Call at creation AND at read time. */
async function realAssertPublicHost(host) {
    if (!isValidGameHostSyntax(host)) throw new Error('Invalid host');
    if (net.isIP(host)) return host;                          // literal, already checked
    const { address } = await dns.lookup(host);               // throws when unresolvable
    const literal = isPublicLiteral(address);
    if (literal !== true) throw new Error('Host resolves to a private address');
    return host;
}

let assertHostImpl = realAssertPublicHost;
/** Throws when the host may not be contacted (private or invalid). Replaceable in tests. */
export function assertPublicHost(host) {
    return assertHostImpl(host);
}

/** The binding of a game counter, validated; null when unusable. */
export function validateGameBinding(game) {
    if (!game || typeof game !== 'object') return null;
    const label = sanitizeLabel(game.label);
    if (!label) return null;
    if (game.provider === 'steam') {
        const appId = sanitizeAppId(game.appId);
        if (!appId) return null;
        return { provider: 'steam', label, appId };
    }
    if (game.provider === 'minecraft' || game.provider === 'fivem') {
        if (typeof game.host !== 'string' || !isValidGameHostSyntax(game.host)) return null;
        const defaultPort = game.provider === 'minecraft' ? 25565 : 30120;
        const port = sanitizePort(game.port, defaultPort);
        if (!port) return null;
        return { provider: game.provider, label, host: game.host.toLowerCase(), port };
    }
    return null;
}

/** The binding of a social counter, validated; null when unusable. */
export function validateSocialBinding(social) {
    if (!social || typeof social !== 'object') return null;
    const label = sanitizeLabel(social.label);
    if (!label) return null;
    if (social.platform === 'youtube') {
        if (typeof social.channelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(social.channelId)) return null;
        return { platform: 'youtube', label, channelId: social.channelId };
    }
    if (social.platform === 'twitch') {
        if (typeof social.login !== 'string' || !/^[A-Za-z0-9_]{4,25}$/.test(social.login)) return null;
        return { platform: 'twitch', label, login: social.login.toLowerCase() };
    }
    if (social.platform === 'x') {
        if (typeof social.username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(social.username)) return null;
        return { platform: 'x', label, username: social.username };
    }
    if (social.platform === 'instagram') {
        if (typeof social.userId !== 'string' || !/^\d{5,25}$/.test(social.userId)) return null;
        return { platform: 'instagram', label, userId: social.userId };
    }
    return null;
}

/** Which environment keys a social counter needs that are missing right now. */
export function missingSocialKeys(platform) {
    const missing = [];
    const need = (name) => { if (!process.env[name]?.trim()) missing.push(name); };
    if (platform === 'youtube') need('YOUTUBE_API_KEY');
    if (platform === 'twitch') { need('TWITCH_CLIENT_ID'); need('TWITCH_CLIENT_SECRET'); }
    if (platform === 'x') need('X_BEARER_TOKEN');
    if (platform === 'instagram') need('INSTAGRAM_ACCESS_TOKEN');
    return missing;
}

// ---------------------------------------------------------------------------
// The swappable network layer
// ---------------------------------------------------------------------------

const realFetchImpl = (...args) => fetch(...args);

let fetchImpl = realFetchImpl;
let pingImpl = null;               // set below; declared here so tests can replace it

/** Tests replace the network entirely; nothing real is touched. */
export function setExternalTransportForTests({ fetch: fetchReplacement, ping: pingReplacement, assertPublicHost: hostReplacement } = {}) {
    fetchImpl = fetchReplacement ?? realFetchImpl;
    pingImpl = pingReplacement ?? realMinecraftPing;
    assertHostImpl = hostReplacement ?? realAssertPublicHost;
}

async function httpJson(url, options = {}) {
    const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_MS),
        redirect: 'error',                    // no silent hop to another host
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
    if (!response || !response.ok) return null;
    const text = await response.text();
    if (text.length > 256 * 1024) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

const playerCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 2_147_483_647) : null);

async function fetchSteam(game) {
    const data = await httpJson(`https://api.steampowered.com/ISteamApps/GetNumberOfCurrentPlayers/v1/?appid=${game.appId}`);
    if (!data || data.response?.result !== 1) return null;
    return playerCount(data.response?.player_count);
}

// --- Minecraft Server List Ping -------------------------------------------------

function writeVarInt(value) {
    const bytes = [];
    let v = value >>> 0;
    do {
        let byte = v & 0x7F;
        v >>>= 7;
        if (v !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (v !== 0);
    return Buffer.from(bytes);
}

function writeString(value) {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([writeVarInt(body.length), body]);
}

function packet(id, body) {
    const idBuf = writeVarInt(id);
    return Buffer.concat([writeVarInt(idBuf.length + body.length), idBuf, body]);
}

function readVarIntFrom(buffer, offset) {
    let value = 0; let size = 0; let current = 0;
    do {
        if (offset + size >= buffer.length) return null;
        current = buffer[offset + size];
        value |= (current & 0x7F) << (7 * size);
        size += 1;
        if (size > 5) return null;
    } while ((current & 0x80) !== 0);
    return { value, size };
}

/** The raw Server List Ping exchange. Resolves with the server's status JSON, or null on any failure. */
function realMinecraftPing(host, port) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => { if (!settled) { settled = true; resolve(value); } };
        let socket;
        try {
            socket = net.createConnection({ host, port, timeout: MC_PING_MS }, () => {});
        } catch {
            done(null);
            return;
        }
        const chunks = [];
        let size = 0;
        socket.on('connect', () => {
            const handshake = Buffer.concat([
                writeVarInt(-1),                            // protocol version: deliberately invalid → server answers with its real status
                writeString(host),
                (() => { const b = Buffer.alloc(2); b.writeUInt16BE(port, 0); return b; })(),
                writeVarInt(1),                             // next state: status
            ]);
            socket.write(packet(0x00, handshake));
            socket.write(packet(0x00, Buffer.alloc(0)));    // status request
        });
        socket.on('data', (chunk) => {
            chunks.push(chunk);
            size += chunk.length;
            if (size > 64 * 1024) { socket.destroy(); done(null); return; }
            const buffer = Buffer.concat(chunks);
            const length = readVarIntFrom(buffer, 0);
            if (!length) return;                            // keep waiting for the length byte(s)
            const needed = length.value + length.size;
            if (buffer.length < needed) return;             // keep waiting for the body
            try {
                const packetId = readVarIntFrom(buffer, length.size);
                const json = readVarIntFrom(buffer, length.size + (packetId?.size ?? 1));
                if (!packetId || packetId.value !== 0x00 || !json) { done(null); return; }
                const start = length.size + packetId.size + json.size;
                const raw = buffer.subarray(start, start + json.value).toString('utf8');
                done(JSON.parse(raw));
            } catch {
                done(null);
            } finally {
                socket.destroy();
            }
        });
        socket.on('timeout', () => { socket.destroy(); done(null); });
        socket.on('error', () => done(null));
        socket.on('close', () => done(null));
    });
}
pingImpl = realMinecraftPing;

async function fetchMinecraft(game) {
    await assertPublicHost(game.host);                        // throws on private hosts → caller treats as unreadable
    const ping = pingImpl ?? realMinecraftPing;
    const status = await ping(game.host, game.port);
    return playerCount(status?.players?.online);
}

async function fetchFivem(game) {
    await assertPublicHost(game.host);
    const base = `http://${game.host}:${game.port}`;
    // Legacy FXServer endpoints, best effort. players.json is an array; info.json varies by build.
    const players = await httpJson(`${base}/players.json`);
    if (Array.isArray(players)) return playerCount(players.length);
    const info = await httpJson(`${base}/info.json`);
    const clients = info?.clients ?? info?.currentPlayers ?? null;
    return playerCount(clients);
}

async function fetchYouTube(social) {
    if (missingSocialKeys('youtube').length) return null;
    const key = process.env.YOUTUBE_API_KEY.trim();
    const data = await httpJson(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(social.channelId)}&key=${encodeURIComponent(key)}`);
    const stats = data?.items?.[0]?.statistics;
    // YouTube omits subscriberCount when the owner hides them — that is honestly unreadable, not zero.
    return stats && stats.hiddenSubscriberCount !== true ? playerCount(Number(stats.subscriberCount)) : null;
}

let twitchToken = null;        // { accessToken, expiresAt }
let twitchUserIds = new Map(); // login → id

async function twitchAppToken() {
    if (twitchToken && twitchToken.expiresAt > Date.now() + 60_000) return twitchToken.accessToken;
    const id = process.env.TWITCH_CLIENT_ID?.trim();
    const secret = process.env.TWITCH_CLIENT_SECRET?.trim();
    if (!id || !secret) return null;
    const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
    const data = await httpJson('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!data?.access_token) return null;
    twitchToken = { accessToken: data.access_token, expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600)) * 1000 };
    return twitchToken.accessToken;
}

async function fetchTwitch(social) {
    const token = await twitchAppToken();
    if (!token) return null;
    const clientId = process.env.TWITCH_CLIENT_ID.trim();
    const headers = { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
    let id = twitchUserIds.get(social.login);
    if (!id) {
        const user = await httpJson(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(social.login)}`, { headers });
        id = user?.data?.[0]?.id;
        if (!id) return null;
        if (twitchUserIds.size > 500) twitchUserIds = new Map();
        twitchUserIds.set(social.login, id);
    }
    const data = await httpJson(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${encodeURIComponent(id)}`, { headers });
    return playerCount(data?.total);
}

async function fetchX(social) {
    const token = process.env.X_BEARER_TOKEN?.trim();
    if (!token) return null;
    const data = await httpJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(social.username)}?user.fields=public_metrics`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return playerCount(data?.data?.public_metrics?.followers_count);
}

async function fetchInstagram(social) {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
    // The counter carries the Instagram BUSINESS user id; the owner token may read any business account it covers.
    if (!token) return null;
    const data = await httpJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(social.userId)}?fields=followers_count&access_token=${encodeURIComponent(token)}`);
    return playerCount(data?.followers_count);
}

const GAME_FETCHERS = { steam: fetchSteam, minecraft: fetchMinecraft, fivem: fetchFivem };
const SOCIAL_FETCHERS = { youtube: fetchYouTube, twitch: fetchTwitch, x: fetchX, instagram: fetchInstagram };

/** Fetch the count of one external counter. Returns a whole number or null — never a guess. */
export async function fetchExternalCount(binding, kind) {
    try {
        const fetcher = kind === 'game' ? GAME_FETCHERS[binding?.provider] : SOCIAL_FETCHERS[binding?.platform];
        if (!fetcher) return null;
        return await fetcher(binding);
    } catch (error) {
        logger.warn(`[SERVERSTATS] External counter (${kind}) could not be read: ${error?.message ?? error}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Short-lived in-memory cache: external sources are polled on a schedule,
// not on every member join. Fresh reads bypass it.
// ---------------------------------------------------------------------------

const externalCache = new Map();   // key → { value, expiresAt }

function cacheKey(kind, binding, guildId) {
    return `${guildId}:${kind}:${kind === 'game'
        ? `${binding.provider}:${binding.appId ?? `${binding.host}:${binding.port}`}`
        : `${binding.platform}:${binding.channelId ?? binding.login ?? binding.username ?? binding.userId}`}`;
}

export async function gatherExternalCounts(counters, { fresh = false, guildId = null } = {}) {
    const targets = (counters ?? []).filter((counter) => counter?.type === 'game' || counter?.type === 'social');
    const out = new Map();
    if (!targets.length) return out;
    const now = Date.now();
    const pending = [];
    for (const counter of targets) {
        const binding = counter.type === 'game' ? counter.game : counter.social;
        if (!binding) { out.set(counter.id, null); continue; }
        const key = cacheKey(counter.type, binding, guildId ?? counter.guildId ?? '');
        const hit = !fresh ? externalCache.get(key) : null;
        if (hit && hit.expiresAt > now) { out.set(counter.id, hit.value); continue; }
        pending.push({ counter, binding, key });
    }
    for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
        const slice = pending.slice(i, i + MAX_CONCURRENT);
        await Promise.all(slice.map(async ({ counter, binding, key }) => {
            const value = await fetchExternalCount(binding, counter.type);
            externalCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
            out.set(counter.id, value);
        }));
    }
    return out;
}

/** For tests: forget every cached external count and the Twitch credentials cache. */
export function resetExternalCountCache() {
    externalCache.clear();
    twitchToken = null;
    twitchUserIds = new Map();
}

/** The base name of an external counter: its label. */
export function externalBaseName(counter) {
    return (counter?.type === 'game' ? counter?.game?.label : counter?.social?.label) ?? (counter?.type === 'game' ? 'Game' : 'Social');
}

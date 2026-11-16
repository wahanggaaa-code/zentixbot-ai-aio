// platforms.js — the network side of Social Alerts (YouTube Data API v3, Twitch Helix).
//
// Every call that leaves this process goes through `httpJson` (timeout, redirect == error,
// bounded JSON). Tests swap the whole network out with `setSocialAlertsTransportForTests`.
// A source that cannot be read returns null / throws a coded error — never a guess.
//
// YouTube quota: playlistItems (~1 unit/call) + videos (~1 unit/call). Live "now" detection rides
// on the same videos call (liveStreamingDetails), so a poll cycle stays around 2 units per alert.
// Shorts detection uses the public redirect behaviour of youtube.com/shorts/<id> (no API cost).

const REQUEST_MS = 8_000;
const MAX_JSON = 256 * 1024;

export const SOCIAL_ALERTS_PLATFORMS = ['youtube', 'twitch'];

const err = (message, code = 'SOCIALALERTS_UPSTREAM', extra = {}) => Object.assign(new Error(message), { code, ...extra });

const realFetch = (...args) => fetch(...args);
let fetchImpl = realFetch;

/** Tests replace the network entirely; nothing real is touched. Pass nothing to restore. */
export function setSocialAlertsTransportForTests({ fetch: replacement } = {}) {
    fetchImpl = replacement ?? realFetch;
}

async function httpJson(url, options = {}) {
    const response = await fetchImpl(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_MS),
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
    if (!response || !response.ok) return null;
    const text = await response.text();
    if (typeof text !== 'string' || text.length > MAX_JSON) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** A HEAD request that only looks at the status. Used for the shorts heuristic; never throws. */
async function headStatus(url) {
    try {
        const response = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(REQUEST_MS) });
        return response?.status ?? null;
    } catch {
        return null;
    }
}

/** Which .env keys one platform needs that are missing right now. */
export function missingPlatformKeys(platform) {
    const missing = [];
    const need = (name) => { if (!process.env[name]?.trim()) missing.push(name); };
    if (platform === 'youtube') need('YOUTUBE_API_KEY');
    if (platform === 'twitch') { need('TWITCH_CLIENT_ID'); need('TWITCH_CLIENT_SECRET'); }
    return missing;
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const YT_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const YT_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;

/**
 * Parse free input (URL, @handle, or channel id) into a YouTube channel handle candidate.
 * Throws SOCIALALERTS_INPUT on garbage. The caller still verifies against the API.
 */
export function parseYouTubeInput(input) {
    if (typeof input !== 'string') throw err('Input channel tidak valid.', 'SOCIALALERTS_INPUT');
    const text = input.trim();
    if (!text || text.length > 200) throw err('Input channel tidak valid.', 'SOCIALALERTS_INPUT');
    if (YT_CHANNEL_ID.test(text)) return { kind: 'id', value: text };
    if (YT_HANDLE.test(text)) return { kind: 'handle', value: text };
    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
        if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') throw new Error();
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'channel' && YT_CHANNEL_ID.test(parts[1] ?? '')) return { kind: 'id', value: parts[1] };
        if (parts[0]?.startsWith('@') && YT_HANDLE.test(parts[0])) return { kind: 'handle', value: parts[0] };
        if (parts[0] === 'c' || parts[0] === 'user') {
            // Legacy custom-url/user pages: resolve via search on the handle-ish segment.
            const legacy = decodeURIComponent(parts[1] ?? '');
            if (/^[A-Za-z0-9._-]{2,64}$/.test(legacy)) return { kind: 'legacy', value: legacy };
        }
        throw new Error();
    } catch {
        throw err('URL atau handle YouTube tidak valid.', 'SOCIALALERTS_INPUT');
    }
}

/**
 * Resolve user input to a channel id + uploads playlist. Verifies the channel exists.
 * Throws SOCIALALERTS_INPUT / SOCIALALERTS_NOT_FOUND / SOCIALALERTS_NO_KEY / SOCIALALERTS_UPSTREAM.
 */
export async function resolveYouTubeChannel(input) {
    if (missingPlatformKeys('youtube').length) throw err('YOUTUBE_API_KEY belum diisi di .env.', 'SOCIALALERTS_NO_KEY');
    const key = process.env.YOUTUBE_API_KEY.trim();
    const parsed = parseYouTubeInput(input);
    const part = 'snippet,contentDetails';
    let data;
    if (parsed.kind === 'id') {
        data = await httpJson(`https://www.googleapis.com/youtube/v3/channels?part=${part}&id=${encodeURIComponent(parsed.value)}&maxResults=1&key=${encodeURIComponent(key)}`);
    } else if (parsed.kind === 'handle') {
        data = await httpJson(`https://www.googleapis.com/youtube/v3/channels?part=${part}&forHandle=${encodeURIComponent(parsed.value)}&maxResults=1&key=${encodeURIComponent(key)}`);
    } else {
        const search = await httpJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(parsed.value)}&maxResults=1&key=${encodeURIComponent(key)}`);
        const channelId = search?.items?.[0]?.snippet?.channelId;
        if (!channelId) throw err('Channel tidak ditemukan.', 'SOCIALALERTS_NOT_FOUND');
        data = await httpJson(`https://www.googleapis.com/youtube/v3/channels?part=${part}&id=${encodeURIComponent(channelId)}&maxResults=1&key=${encodeURIComponent(key)}`);
    }
    const item = data?.items?.[0];
    if (!item?.id) throw err('Channel tidak ditemukan atau tidak dapat dibaca.', 'SOCIALALERTS_NOT_FOUND');
    const channelId = item.id;
    const label = item.snippet?.title ?? 'YouTube';
    const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads ?? `UU${channelId.slice(2)}`;
    return { platform: 'youtube', channelId, uploadsPlaylistId, label };
}

const ISO_DURATION = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
export function durationSeconds(iso) {
    const match = typeof iso === 'string' ? ISO_DURATION.exec(iso) : null;
    if (!match) return null;
    const [, h, m, s] = match;
    return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

/**
 * Fetch the newest uploads with live/shorts classification.
 * Returns { videos: [...], liveNowId: string|null }. Returns null when YouTube cannot be read.
 * Each video: { id, title, url, publishedAt, thumbnail, description, isLive, isUpcoming, isShort, durationSeconds }
 */
export async function fetchYouTubeUpdates(channelId, uploadsPlaylistId, { maxItems = 5 } = {}) {
    if (missingPlatformKeys('youtube').length) return null;
    const key = process.env.YOUTUBE_API_KEY.trim();
    const playlist = await httpJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${maxItems}&key=${encodeURIComponent(key)}`);
    const ids = (playlist?.items ?? []).map((item) => item?.snippet?.resourceId?.videoId).filter(Boolean);
    if (!ids.length) return { videos: [], liveNowId: null };
    const details = await httpJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${encodeURIComponent(ids.join(','))}&key=${encodeURIComponent(key)}`);
    const byId = new Map((details?.items ?? []).map((item) => [item.id, item]));
    // The shorts heuristic costs zero API units; failures just mean "not a short".
    const shortsStatus = await Promise.all(ids.map((id) => headStatus(`https://www.youtube.com/shorts/${encodeURIComponent(id)}`)));
    const videos = [];
    let liveNowId = null;
    ids.forEach((id, index) => {
        const item = byId.get(id);
        if (!item) return;
        const liveBroadcastContent = item.snippet?.liveBroadcastContent ?? 'none';
        const isLive = liveBroadcastContent === 'live';
        const isUpcoming = liveBroadcastContent === 'upcoming';
        if (isLive) liveNowId = id;
        const thumbs = item.snippet?.thumbnails ?? {};
        videos.push({
            id,
            title: item.snippet?.title ?? 'Tanpa judul',
            url: `https://www.youtube.com/watch?v=${id}`,
            publishedAt: item.snippet?.publishedAt ?? null,
            thumbnail: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
            description: item.snippet?.description ?? '',
            isLive,
            isUpcoming,
            isShort: shortsStatus[index] === 200,
            durationSeconds: durationSeconds(item.contentDetails?.duration),
        });
    });
    return { videos, liveNowId };
}

// ---------------------------------------------------------------------------
// Twitch
// ---------------------------------------------------------------------------

const TWITCH_LOGIN = /^[a-z0-9_]{4,25}$/;
const TWITCH_URL = /twitch\.tv\/([A-Za-z0-9_]{4,25})(?:[/?#].*)?$/;

/** Parse free input (URL or bare login). Throws SOCIALALERTS_INPUT on garbage. */
export function parseTwitchInput(input) {
    if (typeof input !== 'string') throw err('Input channel tidak valid.', 'SOCIALALERTS_INPUT');
    const text = input.trim().toLowerCase();
    if (!text) throw err('Input channel tidak valid.', 'SOCIALALERTS_INPUT');
    const match = TWITCH_URL.exec(text);
    const login = match ? match[1] : text.replace(/^@/, '');
    if (!TWITCH_LOGIN.test(login)) throw err('Login Twitch tidak valid (4-25 karakter a-z 0-9 _).', 'SOCIALALERTS_INPUT');
    return login;
}

let twitchToken = null; // { accessToken, expiresAt }

/** An app access token for Twitch Helix, cached in memory until shortly before expiry. */
export async function twitchAppToken() {
    if (twitchToken && twitchToken.expiresAt > Date.now() + 60_000) return twitchToken.accessToken;
    const id = process.env.TWITCH_CLIENT_ID?.trim();
    const secret = process.env.TWITCH_CLIENT_SECRET?.trim();
    if (!id || !secret) return null;
    const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
    const data = await httpJson('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!data?.access_token) return null;
    twitchToken = { accessToken: data.access_token, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 };
    return twitchToken.accessToken;
}

/** Test hook: drop the cached Twitch token (and only that). */
export function resetTwitchTokenCache() {
    twitchToken = null;
}

/**
 * Whether a channel is live right now. `{ live: false }` when it is not (or cannot be read),
 * otherwise the stream snapshot. Never throws.
 */
export async function fetchTwitchLive(login) {
    if (!TWITCH_LOGIN.test(String(login ?? ''))) return { live: false };
    const token = await twitchAppToken();
    if (!token) return { live: false };
    const headers = { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID.trim() };
    const data = await httpJson(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}&first=1`, { headers });
    const stream = data?.data?.[0];
    if (!stream?.id) return { live: false };
    return {
        live: true,
        streamId: String(stream.id),
        title: stream.title ?? 'Live',
        url: `https://www.twitch.tv/${login}`,
        thumbnail: typeof stream.thumbnail_url === 'string'
            ? stream.thumbnail_url.replace('{width}x{height}', '440x248')
            : null,
        viewerCount: Number.isSafeInteger(stream.viewer_count) ? stream.viewer_count : null,
        startedAt: stream.started_at ?? null,
        game: stream.game_name ?? null,
    };
}

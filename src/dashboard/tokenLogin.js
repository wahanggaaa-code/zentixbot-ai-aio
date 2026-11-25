import crypto from 'node:crypto';
import { escapeHtml, pageShell } from './loginPage.js';

/**
 * Login to the dashboard with one secret from the environment, DASHBOARD_TOKEN, instead of going
 * through Discord. Whoever knows the token is the operator of the bot.
 *
 * The dashboard acts in Discord on behalf of an account (it moderates, hosts giveaways, closes
 * tickets), so a token login needs one: the first Discord user ID in OWNER_IDS.
 */
export const TOKEN_MIN_LENGTH = 12;
export const TOKEN_SESSION_MS = 12 * 60 * 60 * 1000;

const isUserId = (text) => /^\d{17,20}$/.test(text);

/**
 * @returns {{ enabled: boolean, reason: null | 'missing' | 'too_short' | 'no_owner', ownerId: string | null }}
 *          The token itself is never part of the result, so that the result can be logged.
 */
export function tokenLoginStatus(env) {
    const token = String(env?.DASHBOARD_TOKEN ?? '').trim();
    const ownerId = String(env?.OWNER_IDS ?? '').split(',').map((id) => id.trim()).find(isUserId) ?? null;
    if (!token) return { enabled: false, reason: 'missing', ownerId };
    if (token.length < TOKEN_MIN_LENGTH) return { enabled: false, reason: 'too_short', ownerId };
    if (!ownerId) return { enabled: false, reason: 'no_owner', ownerId };
    return { enabled: true, reason: null, ownerId };
}

const digest = (text) => crypto.createHash('sha256').update(text).digest();

/** Compares what was typed with DASHBOARD_TOKEN, in a time that does not depend on where they differ. */
export function tokenMatches(candidate, env) {
    const expected = String(env?.DASHBOARD_TOKEN ?? '').trim();
    if (typeof candidate !== 'string' || expected.length < TOKEN_MIN_LENGTH) return false;
    return crypto.timingSafeEqual(digest(candidate.trim()), digest(expected));
}

/**
 * The token carried by a login link, /dashboard/masuk/<token>.
 * @param {string} rest  the part of the path after "/masuk", e.g. "/my-token"
 * @returns {string | null} null when the link carries no token
 */
export function linkToken(rest) {
    const raw = String(rest ?? '').replace(/^\//, '');
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        // Broken percent-encoding ("%ZZ"): taken as it stands, and it will not match.
        return raw;
    }
}

/** Why the token login is off, for someone who opens the login page. */
export function tokenOffMessage(reason, language = 'id') {
    if (language === 'en') {
        if (reason === 'too_short') return `Token login is not enabled: DASHBOARD_TOKEN must contain at least ${TOKEN_MIN_LENGTH} characters.`;
        if (reason === 'no_owner') return 'Token login is not enabled: set OWNER_IDS to your Discord account ID (17 to 20 digits). The dashboard acts on behalf of that account.';
        return 'Token login is not enabled: set DASHBOARD_TOKEN and OWNER_IDS.';
    }
    if (reason === 'too_short') return `Login dengan token belum aktif: DASHBOARD_TOKEN harus minimal ${TOKEN_MIN_LENGTH} karakter.`;
    if (reason === 'no_owner') return 'Login dengan token belum aktif: isi OWNER_IDS dengan ID akun Discord kamu (17 sampai 20 angka). Dashboard bertindak atas nama akun itu.';
    return 'Login dengan token belum aktif: isi DASHBOARD_TOKEN dan OWNER_IDS.';
}

/**
 * The login page: one field for the token.
 * @param {object} [options]
 * @param {string} [options.error]     shown above the field
 */
export function loginFormPage({ error = '', language = 'id', origin = null, ownerId = null } = {}) {
    const english = language === 'en';
    // Only known server-generated messages are translated. Unknown diagnostics stay untouched.
    const messages = new Map([
        ['Token salah.', 'Incorrect token.'],
        ['Token di tautan tidak cocok. Periksa tautannya, atau ketik token di bawah ini.', 'The token in the link does not match. Check the link, or enter the token below.'],
        ['Terlalu banyak sesi aktif.', 'Too many active sessions.'],
        ['Bot belum siap memverifikasi server.', 'The bot is not ready to verify the server.'],
        ['Bot belum tersedia di server yang dikonfigurasi.', 'The bot is not available in the configured server.'],
        ['Permintaan tidak valid. Buka halaman login ini langsung dari alamat dashboard.', 'Invalid request. Open this login page directly from the dashboard address.'],
    ]);
    if (origin) messages.set(`Login hanya diterima dari ${origin}/dashboard/login. Buka alamat itu, atau sesuaikan DASHBOARD_URL dengan alamat yang kamu pakai.`, `Login is only accepted from ${origin}/dashboard/login. Open that address, or set DASHBOARD_URL to the address you use.`);
    if (ownerId) messages.set(`Akun di OWNER_IDS (${ownerId}) bukan anggota server yang dikonfigurasi, atau keanggotaannya tidak dapat diperiksa.`, `The account in OWNER_IDS (${ownerId}) is not a member of the configured server, or its membership cannot be verified.`);
    const displayError = english ? (messages.get(error) ?? error) : error;
    return pageShell({
        language: english ? 'en' : 'id',
        title: english ? 'Log in — Zentix' : 'Masuk — Zentix',
        label: english ? 'LOG IN' : 'MASUK',
        heading: english ? 'Log in<br><em>dashboard</em><span>.</span>' : 'Masuk<br><em>dashboard</em><span>.</span>',
        lead: english ? 'Enter the token to open your server control room.' : 'Ketik token untuk membuka control room server kamu.',
        body: (displayError ? `<p class="error" role="alert">${escapeHtml(displayError)}</p>` : '')
            + `<section class="panel"><div class="panel-head"><div><h2>${english ? 'Dashboard token' : 'Token dashboard'}</h2>`
            + `<p>${english ? `Bot operator only. Sessions last ${TOKEN_SESSION_MS / 3600000} hours.` : `Khusus operator bot. Sesi berlaku ${TOKEN_SESSION_MS / 3600000} jam.`}</p></div><span>◆</span></div>`
            + '<form method="post" action="/dashboard/login">'
            + '<label for="token">Token</label>'
            + '<input id="token" name="token" type="password" autocomplete="current-password" required autofocus>'
            + `<button class="primary" type="submit">${english ? 'Log in' : 'Masuk'}</button></form>`
            + (english ? '<p class="help">The token is the value of <code>DASHBOARD_TOKEN</code> in the bot’s <code>.env</code> file.</p></section>' : '<p class="help">Token adalah isi <code>DASHBOARD_TOKEN</code> pada berkas <code>.env</code> bot.</p></section>')
,
    });
}

import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';
import { isHomeGuild } from '../utils/singleGuild.js';
import { logger } from '../utils/logger.js';
import { dashboardLoginStatus } from './origin.js';
import { linkToken, loginFormPage, tokenLoginStatus, tokenMatches, tokenOffMessage, TOKEN_SESSION_MS } from './tokenLogin.js';
import { noticePage } from './loginPage.js';
import { createBotApiRouter } from './botApi.js';
import { createSelfRolesApi } from './selfRolesApi.js';
import { createGoodbyeApi } from './goodbyeApi.js';
import { createBirthdayApi } from './birthdayApi.js';
import { createCoreApi } from './coreApi.js';
import { createGiveawayApi } from './giveawayApi.js';
import { createJoinToCreateApi } from './joinToCreateApi.js';
import { createJoinToCreateSettingsApi } from './joinToCreateSettingsApi.js';
import { createModulesApi } from './modulesApi.js';
import { createOperationsApi } from './operationsApi.js';
import { createHostingApi } from './hostingApi.js';
import { createSystemUsageApi } from './systemUsageApi.js';
import { createAIApi } from './aiApi.js';
import { createSettingsApi } from './settingsApi.js';
import { createBotPresenceApi } from './botPresenceApi.js';
import { createServerStatsApi } from './serverStatsApi.js';
import { createSocialAlertsApi } from './socialAlertsApi.js';
import { createMessageStudioApi } from './messageStudioApi.js';

const preview = fileURLToPath(new URL('../../dashboard/', import.meta.url));
const random = () => crypto.randomBytes(32).toString('hex');
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(x => x[0] === name)?.[1];
const NO_CACHE = 'no-store';
// These public, content-hashed font files are the only long-lived cacheable assets.
// When a font changes, give it a new hash/name and update the CSS, preload and this list.
const IMMUTABLE_FONTS = new Set([
  'PlusJakartaSans-Variable-125781d6bce03ed5.woff2',
  'RobotoMono-Variable-e9f8c13b3398231d.woff2',
]);

/**
 * Puts the dashboard at /dashboard on the web server.
 *
 * "/dashboard" without the closing slash is sent on to "/dashboard/", because the page's relative
 * addresses (session.js, styles) would otherwise point outside the dashboard. Express matches a
 * route with and without a closing slash, so the address that already has one must be passed
 * through; redirecting it too sends the browser in a circle and the page never opens.
 */
export function mountDashboard(app, client, options) {
  // "/masuk/<token>" is the short form of the login link "/dashboard/masuk/<token>".
  app.use((req, res, next) => { if (/^\/masuk(?:\/|$)/i.test(req.path)) req.url = `/dashboard${req.url}`; next(); });
  app.get('/dashboard', (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect('/dashboard/')));
  app.use('/dashboard', createDashboardRouter(client, options));
}

// Sessions are process-local: deployment with multiple workers needs a shared session store.
export function createDashboardRouter(client, { fetchImpl = globalThis.fetch, env = process.env, systemUsage } = {}) {
  const router = express.Router();
  const sessions = new Map();
  // Resolve the configured public origin for cookies and request validation.
  const { origin, insecure } = dashboardLoginStatus(env, client.homeGuildId);
  // DASHBOARD_TOKEN is the only way to create a dashboard session.
  const tokenLogin = tokenLoginStatus(env);
  if (tokenLogin.enabled && !origin?.startsWith('https:')) logger.warn('Dashboard: token login is on without an https address in DASHBOARD_URL. Over plain HTTP the token and the login session are not encrypted in transit.');
  else if (insecure) logger.warn(`Dashboard is served over plain HTTP at ${origin} (DASHBOARD_ALLOW_HTTP). Login sessions are not encrypted in transit.`);
  if (tokenLogin.reason === 'too_short' || tokenLogin.reason === 'no_owner') logger.warn(`Dashboard: DASHBOARD_TOKEN is set but the token login is off (${tokenLogin.reason === 'too_short' ? 'the token is shorter than 12 characters' : 'OWNER_IDS holds no Discord user ID'}).`);
  // Requests that change something must come from the dashboard's own pages. Without a usable
  // DASHBOARD_URL the address is not known in advance, and the page's address must be the one the
  // request was sent to.
  const fromOwnPage = (req) => {
    const sent = req.get('origin');
    if (origin) return sent === origin;
    try { return Boolean(sent) && new URL(sent).host === req.get('host'); } catch { return false; }
  };
  // The login form is posted by the browser itself, not by a script, and a browser does not always name the
  // page a form came from: under a strict referrer policy, or with privacy settings, it sends "Origin: null".
  // Refusing that locked the operator out of the form (14 November 2026). So for the login only:
  // a named origin must be the dashboard's own; under "Origin: null" a cross-site request is refused where
  // the browser says so (Sec-Fetch-Site, sent over https and on localhost), and the request must have been
  // sent to the dashboard's address. Over plain http that leaves a form on another site able to submit a token.
  // It gains nothing by it: it cannot read the answer, attempts are counted per address, and whoever knows
  // the token can open the dashboard anyway.
  const loginPostAllowed = (req) => {
    const sent = req.get('origin');
    if (!sent) return true; // not a browser (curl, a script): the token is the proof
    if (sent !== 'null') return fromOwnPage(req);
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return false;
    try { return !origin || new URL(origin).host === req.get('host'); } catch { return false; }
  };
  // Pages a person reads before the dashboard opens. "same-origin" instead of the "no-referrer" used
  // everywhere else, so that the browser names this page as the origin when it posts the login form.
  const page = (res, status, html) => res.status(status).set('Referrer-Policy', 'same-origin').send(html);
  const language = req => cookie(req, 'zentix_language') === 'en' ? 'en' : 'id';
  const notice = (res, status, message, more) => page(res, status, noticePage(message, { ...more, language: language(res.req) }));
  const loginForm = (req, res) => (status, error) => page(res, status, loginFormPage({ error, language: language(req), origin, ownerId: tokenLogin.ownerId }));
  const options = { httpOnly: true, secure: origin?.startsWith('https:') || false, sameSite: 'lax', path: '/dashboard' };
  const clear = (res, name) => res.clearCookie(name, options);
  const purge = () => { const now = Date.now(); for (const [k,v] of sessions) if (v.expires < now) sessions.delete(k); };
  // `operator` is true for a token login: the holder of DASHBOARD_TOKEN runs the bot, and acts as
  // the account in OWNER_IDS whether or not that account is an administrator of the server.
  async function authorize(userId, operator = false) {
    if (!client.isReady?.()) return { status: 503, error: 'Bot belum siap memverifikasi server.' };
    const guild = client.guilds.cache.get(client.homeGuildId);
    if (!guild || !isHomeGuild(client, guild.id)) return { status: 503, error: 'Bot belum tersedia di server yang dikonfigurasi.' };
    try {
      const member = await guild.members.fetch({ user: userId, force: true });
      if (!operator && guild.ownerId !== userId && !member.permissions.has(PermissionFlagsBits.Administrator)) return { status: 403, error: 'Akses hanya untuk owner atau administrator server.' };
      return { guild, member };
    } catch { return { status: 403, error: 'Keanggotaan atau izin server tidak dapat diverifikasi.' }; }
  }
  router.use((req,res,next) => { res.set({'Cache-Control': NO_CACHE, 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY'}); next(); });
  router.get('/login', (req,res) => {
    if (!tokenLogin.enabled) return notice(res, 503, tokenOffMessage(tokenLogin.reason, language(req)), { href: null });
    return loginForm(req, res)(200, '');
  });
  const WRONG_ADDRESS = `Login hanya diterima dari ${origin}/dashboard/login. Buka alamat itu, atau sesuaikan DASHBOARD_URL dengan alamat yang kamu pakai.`;
  // Opens the session of a token login once the token has been found right; `form` shows the login page with a message.
  async function openTokenSession(req, res, form, how) {
    purge();
    const access = await authorize(tokenLogin.ownerId, true);
    if (access.error) {
      logger.warn(`Dashboard: token login could not be completed (${access.error})`);
      return form(access.status, access.status === 403 ? `Akun di OWNER_IDS (${tokenLogin.ownerId}) bukan anggota server yang dikonfigurasi, atau keanggotaannya tidak dapat diperiksa.` : access.error);
    }
    if (sessions.size >= 5000) return form(503, 'Terlalu banyak sesi aktif.');
    const person = access.member?.user;
    const id = random(); sessions.set(id, { user: { id: tokenLogin.ownerId, username: person?.globalName || person?.username || 'Owner' }, csrf: random(), expires: Date.now() + TOKEN_SESSION_MS, operator: true, member: access.member });
    res.cookie('zx_session', id, { ...options, maxAge: TOKEN_SESSION_MS });
    logger.info(`Dashboard: token login${how} from ${req.ip}, acting as ${tokenLogin.ownerId}`);
    res.redirect(303, '/dashboard/');
  }
  router.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), async (req,res) => {
    const form = loginForm(req, res);
    if (!tokenLogin.enabled) return notice(res, 503, tokenOffMessage(tokenLogin.reason, language(req)), { href: null });
    if (!loginPostAllowed(req)) return form(403, origin ? WRONG_ADDRESS : 'Permintaan tidak valid. Buka halaman login ini langsung dari alamat dashboard.');
    if (!tokenMatches(req.body?.token, env)) {
      logger.warn(`Dashboard: token login refused for ${req.ip} (wrong token)`);
      return form(401, 'Token salah.');
    }
    await openTokenSession(req, res, form, '');
  });
  // Login by link: /dashboard/masuk/<token>, where the token is everything after "/masuk/". The
  // address of a link ends up in the browser's history and wherever the link is pasted, so the
  // answer never repeats it and the browser is sent on to /dashboard/ at once.
  router.use('/masuk', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const form = loginForm(req, res);
    const typed = linkToken(req.path);
    if (typed === null) return res.redirect('/dashboard/login');
    if (!tokenLogin.enabled) return notice(res, 503, tokenOffMessage(tokenLogin.reason, language(req)), { href: null });
    if (origin && new URL(origin).host !== req.get('host')) return form(403, WRONG_ADDRESS);
    if (!tokenMatches(typed, env)) {
      logger.warn(`Dashboard: token login refused for ${req.ip} (wrong token in a login link)`);
      return form(401, 'Token di tautan tidak cocok. Periksa tautannya, atau ketik token di bawah ini.');
    }
    await openTokenSession(req, res, form, ' by link');
  });
  router.get('/callback', (req,res) => notice(res, 403, language(req) === 'en'
    ? 'Discord login is disabled. Use the dashboard token.'
    : 'Login Discord dinonaktifkan. Gunakan token dashboard.'));
  // Share only an ongoing verification between concurrent reads in one session. Never cache
  // its result or share it with a write: later requests must re-check access with Discord.
  const pendingReadAccess = new WeakMap();
  async function auth(req,res,next) {
    purge(); const session = sessions.get(cookie(req,'zx_session'));
    if (!session) return res.status(401).json({error:'Silakan login.'});
    const start = process.hrtime.bigint();
    // A token session represents the operator. Its initial membership was verified at login;
    // reuse that identity for reads so page navigation does not wait for Discord each time.
    // This deliberately allows reads after membership changes until logout or expiry. Writes
    // always go through a fresh authorization and retain their own Discord permission checks.
    if (session.operator === true && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!client.isReady?.()) return res.status(503).json({error:'Bot belum siap memverifikasi server.'});
      const guild = client.guilds.cache.get(client.homeGuildId);
      if (!guild || !isHomeGuild(client, guild.id) || !session.member) return res.status(503).json({error:'Bot belum tersedia di server yang dikonfigurasi.'});
      res.set('Server-Timing', `dashboard-auth;dur=${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(1)}`);
      req.session = session; req.guild = guild; req.member = session.member; return next();
    }
    let pending = req.method === 'GET' || req.method === 'HEAD' ? pendingReadAccess.get(session) : null;
    if (!pending) {
      pending = authorize(session.user.id, session.operator === true);
      if (req.method === 'GET' || req.method === 'HEAD') {
        pendingReadAccess.set(session, pending);
        const clearPending = () => { if (pendingReadAccess.get(session) === pending) pendingReadAccess.delete(session); };
        pending.then(clearPending, clearPending);
      }
    }
    const access = await pending;
    res.set('Server-Timing', `dashboard-auth;dur=${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(1)}`);
    if (sessions.get(cookie(req,'zx_session')) !== session || session.expires <= Date.now()) return res.status(401).json({error:'Silakan login.'});
    if (access.error) { delete session.verifiedAt; return res.status(access.status).json({error:access.error}); }
    session.verifiedAt = Date.now();
    if (session.operator === true) session.member = access.member;
    req.session = session; req.guild = access.guild; req.member = access.member; next();
  }
  // For a route the page asks every few seconds. `auth` asks Discord about the member on every request;
  // doing that twenty times a minute per open tab would spend the bot's request budget on nothing.
  // Here the answer of the last check is trusted for a minute. Only for routes that read and change nothing.
  const POLL_TRUST_MS = 60 * 1000;
  async function authPolled(req,res,next) {
    purge(); const session = sessions.get(cookie(req,'zx_session'));
    if (!session) return res.status(401).json({error:'Silakan login.'});
    if (!(Date.now() - session.verifiedAt < POLL_TRUST_MS)) return auth(req,res,next);
    req.session = session; next();
  }
  const csrf = (req,res,next) => {
    if (!fromOwnPage(req) || req.get('x-csrf-token') !== req.session.csrf) return res.status(403).json({error:'Permintaan tidak valid.'});
    next();
  };
  router.use('/api/bot', createBotApiRouter(client, {auth, csrf}));
  // Self-roles first: their banner payload needs the big parser in selfRolesApi, so no small blanket
  // parser mounted before it may see those requests (goodbye/birthday parsers are also path-scoped since the banner fix).
  router.use('/api/bot', createSelfRolesApi(client, { auth, csrf }));
  router.use('/api/bot', createGoodbyeApi(client, {auth, csrf}));
  router.use('/api/bot', createBirthdayApi(client, {auth, csrf}));
  router.use('/api/bot', createCoreApi(client, {auth, csrf}));
  router.use('/api/bot', createGiveawayApi(client, {auth, csrf}));
  router.use('/api/bot', createJoinToCreateApi(client, {auth}));
  router.use('/api/bot', createJoinToCreateSettingsApi(client, {auth, csrf}));
  router.use('/api/bot', createServerStatsApi(client, {auth, csrf}));
  router.use('/api/bot', createSocialAlertsApi(client, {auth, csrf}));
  router.use('/api/bot', createModulesApi(client, {auth, csrf}));
  router.use('/api/bot', createOperationsApi(client, {auth, csrf}));
  router.use('/api/bot', createHostingApi({auth, env}));
  router.use('/api/bot', createSystemUsageApi({auth: authPolled, env, ...(systemUsage ? {usage: systemUsage} : {})}));
  router.use('/api/bot', createSettingsApi(client, {auth, env}));
  router.use('/api/bot', createBotPresenceApi(client, {auth, csrf, env}));
  router.use('/api/ai', createAIApi(client, {auth, csrf, env}));
  router.use('/api/message-studio', createMessageStudioApi(client, {auth, csrf, env}));
  // botOwner lets AI Studio say up front that its routes will refuse this account (see `owner` in aiApi.js).
  const botOwners = () => String(env.OWNER_IDS || '').split(',').map((x) => x.trim()).filter((x) => /^\d{17,20}$/.test(x));
  router.get('/api/me', auth, (req,res) => res.json({user:req.session.user, guild:{id:req.guild.id,name:req.guild.name}, csrf:req.session.csrf, botReady:client.isReady(), botOwner:botOwners().includes(req.session.user.id)}));
  // Logging out must remain possible even if Discord is offline or the member has left.
  // It only removes the caller's own session and still requires the origin and CSRF token.
  router.post('/api/logout', (req,res) => {
    purge(); const id = cookie(req,'zx_session'), session = sessions.get(id);
    if (!session) return res.status(401).json({error:'Silakan login.'});
    if (!fromOwnPage(req) || req.get('x-csrf-token') !== session.csrf) return res.status(403).json({error:'Permintaan tidak valid.'});
    sessions.delete(id); clear(res,'zx_session'); res.json({ok:true});
  });
  router.get(['/', '/index.html'], (req,res,next) => {
    if (!tokenLogin.enabled) return notice(res, 503, tokenOffMessage(tokenLogin.reason, language(req)), { href: null });
    purge(); if (!sessions.has(cookie(req,'zx_session'))) return res.redirect('/dashboard/login');
    auth(req,res,() => res.sendFile(path.join(preview,'index.html')));
  });
  router.use(express.static(preview, {
    index:false, dotfiles:'deny', extensions:false,
    setHeaders(res, filePath) {
      if (path.dirname(filePath) === path.join(preview, 'fonts') && IMMUTABLE_FONTS.has(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      } else if (path.dirname(filePath) === preview.replace(/[\\/]$/, '') && /\.(?:css|js)$/.test(filePath)) {
        // Public application code, not HTML or API responses. Always revalidate so
        // a deployment never leaves a browser running an outdated dashboard.
        res.setHeader('Cache-Control', 'private, no-cache');
      }
    },
  }));
  return router;
}

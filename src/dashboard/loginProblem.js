import { noticePage } from './loginPage.js';

/**
 * Why a request to /dashboard/callback cannot finish a login, and what to show for it.
 *
 * @param {object} facts
 * @param {unknown} facts.state    `state` from the query string
 * @param {boolean} facts.known    whether the server still holds that state as pending
 * @param {string | undefined} facts.sent  the state cookie the browser sent
 * @param {unknown} facts.code     `code` from the query string
 * @param {boolean} facts.denied   whether Discord reported an error instead of a code
 * @returns {null | 'incomplete' | 'spent' | 'no_cookie' | 'other_login' | 'denied'}
 */
export function callbackProblem({ state, known, sent, code, denied }) {
    if (typeof state !== 'string') return 'incomplete';
    if (!known) return 'spent';
    if (!sent) return 'no_cookie';
    if (sent !== state) return 'other_login';
    if (denied) return 'denied';
    if (typeof code !== 'string' || code.length > 2048) return 'incomplete';
    return null;
}

const MESSAGES = {
    incomplete: () => 'Alamat ini tidak lengkap. Halaman ini hanya dibuka oleh Discord setelah kamu menekan Authorize.',
    spent: () => 'Login ini sudah tidak berlaku. Penyebabnya salah satu dari tiga hal: halaman ini dimuat ulang, login dibiarkan lebih dari 10 menit, atau bot restart saat kamu sedang login.',
    no_cookie: (origin) => `Browser ini tidak mengirim cookie login. Biasanya karena login dimulai di browser lain atau di tab private, dashboard dibuka lewat alamat selain ${origin}, atau browser memblokir cookie untuk alamat ini.`,
    other_login: () => 'Ada login lain yang dimulai lebih baru di browser ini, sehingga login yang ini tidak dipakai lagi.',
    denied: () => 'Login dibatalkan di halaman Discord.',
};

const EN_MESSAGES = {
    incomplete: () => 'This address is incomplete. Discord opens this page after you press Authorize.',
    spent: () => 'This login is no longer valid. The page may have been reloaded, the login left for more than 10 minutes, or the bot restarted during login.',
    no_cookie: (origin) => `This browser did not send the login cookie. Login may have started in another browser or a private tab, the dashboard may have been opened at an address other than ${origin}, or the browser may block cookies for this address.`,
    other_login: () => 'A newer login was started in this browser, so this login is no longer used.',
    denied: () => 'Login was cancelled on the Discord page.',
};

/** A page that names the problem and links back to the login. */
export function loginProblemPage(problem, origin, language = 'id') {
    const messages = language === 'en' ? EN_MESSAGES : MESSAGES;
    return noticePage(messages[problem](origin), { title: 'Login dashboard gagal', label: 'LOGIN GAGAL', action: 'Mulai login lagi', language });
}

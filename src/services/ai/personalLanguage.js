// Per-member personal language for the translation features, e.g. what "Tekan-tahan pesan → Apps → Terjemahkan"
// translates into. One record per server per member, no expiry, on the same AI storage as the other AI settings.
import { LANGUAGES } from './smartSettings.js';

export const personalKey = (guildId, userId) => `ai:translate:personal:${guildId}:${userId}`;

export function createPersonalLanguageStore(kv) {
    return {
        /** The member's language code, or null when not set or unreadable. Never throws: callers fall back to the server default. */
        async get(guildId, userId) {
            if (!/^\d{17,20}$/.test(String(guildId)) || !/^\d{17,20}$/.test(String(userId))) return null;
            try {
                const value = await kv.get(personalKey(guildId, userId));
                return value && typeof value === 'object' && LANGUAGES[value.language] ? value.language : null;
            } catch { return null; }
        },
        /** Stores the member's language. Throws (status 400) for an unsupported code. */
        async set(guildId, userId, code) {
            if (!LANGUAGES[code]) throw Object.assign(new Error('Bahasa tidak didukung.'), { status: 400 });
            await kv.set(personalKey(guildId, userId), { language: code });
            return code;
        },
        /** Removes the member's language; the server default is used again. */
        async clear(guildId, userId) {
            await kv.set(personalKey(guildId, userId), null);
        },
    };
}

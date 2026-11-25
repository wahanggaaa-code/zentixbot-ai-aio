import { createKV } from './kv.js';

// Both features send data to an AI provider and are opt-in per server.
export const DEFAULT_AI_FEATURE_CONTROLS = Object.freeze({ ticketSummaryEnabled: false, musicDjEnabled: false, ticketAutoSummaryEnabled: false });
export function validateAIFeatureControls(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'musicDjEnabled,ticketAutoSummaryEnabled,ticketSummaryEnabled' ||
        typeof value.ticketSummaryEnabled !== 'boolean' || typeof value.musicDjEnabled !== 'boolean' || typeof value.ticketAutoSummaryEnabled !== 'boolean') {
        throw Object.assign(new Error('Pengaturan fitur AI tidak valid.'), { status: 400 });
    }
    return { ticketSummaryEnabled: value.ticketSummaryEnabled, musicDjEnabled: value.musicDjEnabled, ticketAutoSummaryEnabled: value.ticketAutoSummaryEnabled };
}
function stored(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'musicDjEnabled,ticketSummaryEnabled') return validateAIFeatureControls({ ...value, ticketAutoSummaryEnabled: false });
    return validateAIFeatureControls(value);
}
export function createAIFeatureControlsStore(client, kv = createKV(client)) {
    const key = id => `ai:feature-controls:${id}`;
    return {
        async read(id) { const value = await kv.get(key(id)); return value === null ? { ...DEFAULT_AI_FEATURE_CONTROLS } : stored(value); },
        async save(id, value) { const settings = validateAIFeatureControls(value); await kv.set(key(id), settings); return settings; },
        async setEnabled(id, feature, enabled) {
            const fields = { ticket: 'ticketSummaryEnabled', music: 'musicDjEnabled', 'ticket-auto': 'ticketAutoSummaryEnabled' };
            if (!Object.hasOwn(fields, feature) || typeof enabled !== 'boolean') throw Object.assign(new Error('Pengaturan fitur AI tidak valid.'), { status: 400 });
            return kv.update(key(id), current => ({ ...(current === null ? { ...DEFAULT_AI_FEATURE_CONTROLS } : stored(current)), [fields[feature]]: enabled }));
        },
    };
}

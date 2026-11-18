// Bounded, declarative Message Studio action lists. No code execution or user-supplied webhook URLs.
const fail = (message) => Object.assign(new Error(message), { status: 400, code: 'MESSAGE_STUDIO_FLOW_INVALID' });
const obj = (x, keys) => { if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some((key) => !keys.includes(key))) throw fail('Action flow tidak valid.'); };
const snowflake = (v) => typeof v === 'string' && /^\d{17,20}$/.test(v);
const name = (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const text = (v, max = 2000) => { if (typeof v !== 'string' || !v.trim() || v.includes('\0') || v.length > max) throw fail('Teks action flow tidak valid.'); return v; };

/** Validate and copy at the boundary, including nested branches and the total execution budget. */
export function normalizeStudioFlow(value) {
    let steps = 0, seconds = 0;
    function list(actions, depth) {
        if (!Array.isArray(actions) || depth > 3) throw fail('Flow harus berupa daftar action dengan maksimal 3 tingkat kondisi.');
        return actions.map((action) => {
            if (++steps > 20) throw fail('Flow maksimal 20 action termasuk cabang.');
            obj(action, ['type', 'seconds', 'roleId', 'channelId', 'message', 'name', 'value', 'condition', 'then', 'else', 'templateId', 'private', 'title', 'fields']);
            const { type } = action;
            const only = (allowed) => obj(action, ['type', ...allowed]);
            if (type === 'noop' || type === 'stop' || type === 'delete_message') { only([]); return { type }; }
            if (type === 'wait') { only(['seconds']); if (!Number.isInteger(action.seconds) || action.seconds < 0 || action.seconds > 10 || (seconds += action.seconds) > 20) throw fail('Jeda maksimal 10 detik per action dan 20 detik per flow.'); return { type, seconds: action.seconds }; }
            if (['add_role', 'remove_role', 'toggle_role'].includes(type)) { only(['roleId']); if (!snowflake(action.roleId)) throw fail('Role flow tidak valid.'); return { type, roleId: action.roleId }; }
            if (type === 'set_variable') { only(['name', 'value']); if (!name(action.name)) throw fail('Nama variabel tidak valid.'); return { type, name: action.name, value: text(action.value, 500) }; }
            if (type === 'check') {
                only(['condition', 'then', 'else']); obj(action.condition, ['type', 'roleId', 'name', 'value']);
                const c = action.condition;
                if (c.type === 'has_role') { obj(c, ['type', 'roleId']); if (!snowflake(c.roleId)) throw fail('Role kondisi tidak valid.'); }
                else if (c.type === 'variable_equals') { obj(c, ['type', 'name', 'value']); if (!name(c.name)) throw fail('Variabel kondisi tidak valid.'); text(c.value, 500); }
                else throw fail('Jenis kondisi tidak didukung.');
                return { type, condition: { ...c }, then: list(action.then || [], depth + 1), else: list(action.else || [], depth + 1) };
            }
            if (type === 'open_modal') {
                only(['title', 'channelId', 'fields']);
                if (depth !== 0 || actions.length !== 1) throw fail('Open Modal harus menjadi satu-satunya action tombol.');
                if (!snowflake(action.channelId) || !Array.isArray(action.fields) || !action.fields.length || action.fields.length > 5) throw fail('Formulir tidak valid.');
                const title = text(action.title, 45), ids = new Set();
                const fields = action.fields.map((field) => {
                    obj(field, ['id', 'label', 'style', 'required']);
                    if (!name(field.id) || ids.has(field.id) || !['short', 'paragraph'].includes(field.style) || typeof field.required !== 'boolean') throw fail('Kolom formulir tidak valid.');
                    ids.add(field.id); return { id: field.id, label: text(field.label, 45), style: field.style, required: field.required };
                });
                return { type, title, channelId: action.channelId, fields };
            }
            if (type === 'send_message' && action.templateId !== undefined) {
                only(['templateId', 'private', 'channelId']);
                if (typeof action.templateId !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(action.templateId)) throw fail('Template flow tidak valid.');
                if (action.channelId !== undefined) {
                    if (!snowflake(action.channelId) || action.private !== undefined) throw fail('Channel template tidak valid.');
                    return { type, templateId: action.templateId, channelId: action.channelId };
                }
                if (typeof action.private !== 'boolean') throw fail('Visibilitas template flow tidak valid.');
                return { type, templateId: action.templateId, private: action.private };
            }
            if (type === 'send_message' || type === 'send_webhook_message') { only(['channelId', 'message']); if (!snowflake(action.channelId)) throw fail('Channel flow tidak valid.'); return { type, channelId: action.channelId, message: text(action.message, 4000) }; }
            if (type === 'create_thread') { only(['channelId', 'name']); if (!snowflake(action.channelId)) throw fail('Channel thread tidak valid.'); return { type, channelId: action.channelId, name: text(action.name, 100) }; }
            throw fail('Action flow tidak dikenal.');
        });
    }
    const result = list(value, 0);
    if (!result.length) throw fail('Flow harus berisi sedikitnya satu action.');
    return result;
}

/** Dependencies are supplied by the service; lastMessage never accepts an arbitrary message ID. */
export async function runStudioFlow(flow, context) {
    const actions = normalizeStudioFlow(flow), variables = Object.create(null);
    let lastMessage = null;
    const interpolate = (s) => s.replace(/\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g, (m, key) => Object.hasOwn(variables, key) ? variables[key] : m);
    async function run(list) {
        for (const action of list) {
            switch (action.type) {
                case 'noop': break;
                case 'stop': return false;
                case 'wait': await context.wait(action.seconds); break;
                case 'set_variable': variables[action.name] = interpolate(action.value); break;
                case 'check': {
                    const c = action.condition;
                    const ok = c.type === 'has_role' ? await context.hasRole(c.roleId) : variables[c.name] === interpolate(c.value);
                    if (!await run(ok ? action.then : action.else)) return false;
                    break;
                }
                case 'add_role': case 'remove_role': case 'toggle_role': await context.changeRole(action.type, action.roleId); break;
                case 'send_message': case 'send_webhook_message': lastMessage = action.templateId ? await context.sendTemplate(action.templateId, action.private, action.channelId) : await context.send(action.type, action.channelId, interpolate(action.message)); break;
                case 'create_thread': await context.createThread(action.channelId, interpolate(action.name)); break;
                case 'delete_message': if (!lastMessage) throw new Error('Tidak ada pesan yang dibuat flow ini untuk dihapus.'); await context.deleteMessage(lastMessage); lastMessage = null; break;
                default: throw fail('Action flow tidak dikenal.');
            }
        }
        return true;
    }
    await run(actions);
}

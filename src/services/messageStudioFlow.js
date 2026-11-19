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
            obj(action, ['type', 'seconds', 'roleId', 'roleIds', 'channelId', 'message', 'name', 'value', 'condition', 'then', 'else', 'templateId', 'private', 'title', 'fields', 'onSubmit']);
            const { type } = action;
            const only = (allowed) => obj(action, ['type', ...allowed]);
            if (type === 'noop' || type === 'stop' || type === 'delete_message') { only([]); return { type }; }
            if (type === 'wait') { only(['seconds']); if (!Number.isInteger(action.seconds) || action.seconds < 0 || action.seconds > 10 || (seconds += action.seconds) > 20) throw fail('Jeda maksimal 10 detik per action dan 20 detik per flow.'); return { type, seconds: action.seconds }; }
            if (type === 'schedule_message') { only(['seconds', 'channelId', 'message']); if (!Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 604800 || !snowflake(action.channelId)) throw fail('Jadwal pesan harus 1–604800 detik dengan channel valid.'); return { type, seconds: action.seconds, channelId: action.channelId, message: text(action.message, 4000) }; }
            if (['add_role', 'remove_role', 'toggle_role'].includes(type)) { only(['roleId']); if (!snowflake(action.roleId)) throw fail('Role flow tidak valid.'); return { type, roleId: action.roleId }; }
            if (type === 'select_unique_role') {
                only(['roleId', 'roleIds']);
                if (!snowflake(action.roleId) || !Array.isArray(action.roleIds) || action.roleIds.length < 2 || action.roleIds.length > 10 || action.roleIds.some((id) => !snowflake(id)) || new Set(action.roleIds).size !== action.roleIds.length || !action.roleIds.includes(action.roleId)) throw fail('Grup role unik harus berisi 2–10 ID berbeda termasuk role pilihan.');
                return { type, roleId: action.roleId, roleIds: [...action.roleIds] };
            }
            if (type === 'set_variable') { only(['name', 'value']); if (!name(action.name)) throw fail('Nama variabel tidak valid.'); return { type, name: action.name, value: text(action.value, 500) }; }
            if (type === 'check') {
                only(['condition', 'then', 'else']); obj(action.condition, ['type', 'roleId', 'name', 'value']);
                const c = action.condition;
                if (c.type === 'has_role') { obj(c, ['type', 'roleId']); if (!snowflake(c.roleId)) throw fail('Role kondisi tidak valid.'); }
                else if (['variable_equals', 'variable_not_equals', 'variable_contains'].includes(c.type)) { obj(c, ['type', 'name', 'value']); if (!name(c.name)) throw fail('Variabel kondisi tidak valid.'); text(c.value, 500); }
                else if (c.type === 'variable_exists') { obj(c, ['type', 'name']); if (!name(c.name)) throw fail('Variabel kondisi tidak valid.'); }
                else throw fail('Jenis kondisi tidak didukung.');
                return { type, condition: { ...c }, then: list(action.then || [], depth + 1), else: list(action.else || [], depth + 1) };
            }
            if (type === 'open_modal') {
                only(['title', 'channelId', 'fields', 'onSubmit']);
                if (depth !== 0 || actions.length !== 1) throw fail('Open Modal harus menjadi satu-satunya action tombol.');
                if (!snowflake(action.channelId) || !Array.isArray(action.fields) || !action.fields.length || action.fields.length > 5) throw fail('Formulir tidak valid.');
                const title = text(action.title, 45), ids = new Set();
                const fields = action.fields.map((field) => {
                    obj(field, ['id', 'label', 'style', 'required']);
                    if (!name(field.id) || ids.has(field.id) || !['short', 'paragraph'].includes(field.style) || typeof field.required !== 'boolean') throw fail('Kolom formulir tidak valid.');
                    ids.add(field.id); return { id: field.id, label: text(field.label, 45), style: field.style, required: field.required };
                });
                const onSubmit = action.onSubmit === undefined ? undefined : list(action.onSubmit, depth + 1);
                if (onSubmit && !onSubmit.length) throw fail('Flow formulir harus berisi action.');
                return { type, title, channelId: action.channelId, fields, ...(onSubmit ? { onSubmit } : {}) };
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

// Continuations cannot use interaction tokens, message handles or foreign webhooks.
// Unsupported flows retain the existing in-memory wait behavior.
export function supportsDurableStudioFlow(flow) {
    const allowed = new Set(['noop','stop','wait','schedule_message','set_variable','check','add_role','remove_role','toggle_role','select_unique_role','send_message','send_webhook_message','create_thread','delete_message']);
    const visit = list => list.every(action => allowed.has(action.type) && !(action.type === 'send_message' && action.templateId !== undefined && action.channelId === undefined) && (action.type !== 'check' || (visit(action.then) && visit(action.else))));
    try { return visit(normalizeStudioFlow(flow)); } catch { return false; }
}
export function normalizeStudioCheckpoint(resume) {
    obj(resume, ['version', 'remaining', 'variables', 'lastMessage']);
    if (resume.version !== 1 || !resume.variables || typeof resume.variables !== 'object' || Array.isArray(resume.variables) || Object.keys(resume.variables).length > 20) throw fail('Checkpoint flow tidak valid.');
    const variables = Object.create(null);
    for (const [key, value] of Object.entries(resume.variables)) {
        if (!name(key) || typeof value !== 'string' || value.length > 4000 || value.includes('\0')) throw fail('Variabel checkpoint tidak valid.');
        variables[key] = value;
    }
    const remaining = normalizeStudioFlow(resume.remaining);
    if (!supportsDurableStudioFlow(remaining)) throw fail('Action checkpoint belum didukung.');
    let lastMessage;
    if (resume.lastMessage !== undefined && resume.lastMessage !== null) {
        obj(resume.lastMessage, ['kind', 'channelId', 'messageId', 'webhookId', 'sessionId']);
        const ref=resume.lastMessage;
        if (!['bot','webhook'].includes(ref.kind) || !snowflake(ref.channelId) || !snowflake(ref.messageId) || (ref.kind === 'webhook' ? !snowflake(ref.webhookId) : ref.webhookId !== undefined) || (ref.sessionId !== undefined && (ref.kind !== 'bot' || typeof ref.sessionId !== 'string' || !/^flow-[A-Za-z0-9_-]{1,43}$/.test(ref.sessionId)))) throw fail('Referensi pesan checkpoint tidak valid.');
        lastMessage = { ...ref };
    }
    return { version: 1, remaining, variables: { ...variables }, ...(lastMessage ? { lastMessage } : {}) };
}

/** Dependencies are supplied by the service; lastMessage never accepts an arbitrary message ID. */
export async function runStudioFlow(flow, context, resume = null) {
    // Checkpoints contain only validated actions and variables; interaction tokens
    // and message handles never become part of a continuation.
    let actions, variables = Object.create(null), restoredLastMessage = null;
    if (resume !== null) {
        const valid = normalizeStudioCheckpoint(resume);
        Object.assign(variables, valid.variables);
        actions = valid.remaining;
        restoredLastMessage = valid.lastMessage ?? null;
    } else {
        actions = normalizeStudioFlow(flow);
        if (context.initialVariables !== undefined) {
            const valid = normalizeStudioCheckpoint({ version: 1, remaining: [{type:'noop'}], variables: context.initialVariables });
            Object.assign(variables, valid.variables);
        }
    }
    let lastMessage = restoredLastMessage;
    // Bound expansion while building, not after allocating a potentially huge string.
    const interpolate = (s) => {
        let result = '', offset = 0;
        const pattern = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;
        const append = (part) => { if (result.length + part.length > 4000) throw new Error('Hasil variabel flow terlalu panjang.'); result += part; };
        for (const match of s.matchAll(pattern)) {
            append(s.slice(offset, match.index));
            append(Object.hasOwn(variables, match[1]) ? variables[match[1]] : match[0]);
            offset = match.index + match[0].length;
        }
        append(s.slice(offset));
        return result;
    };
    // Flatten only branches already chosen; unvisited checks remain declarative.
    // This keeps the continuation bounded and independent of recursion frames.
    let pending = [...actions];
    while (pending.length) {
        const action = pending.shift();
        switch (action.type) {
            case 'noop': break;
            case 'stop': return;
            case 'wait': {
                if (context.checkpoint && (pending.length || context.checkpointOnFinalWait)) {
                    // Store only an internal reference to a message produced by this
                    // flow, never interaction tokens or executable message handles.
                    const ref = lastMessage?.checkpointRef || (lastMessage?.kind ? lastMessage : null);
                    if (lastMessage !== null && !ref && !context.discardLastMessageOnCheckpoint) throw Error('Checkpoint setelah pesan flow belum didukung.');
                    const snapshot = { version: 1, remaining: structuredClone(pending.length ? pending : [{ type: 'noop' }]), variables: { ...variables }, ...(ref ? { lastMessage: structuredClone(ref) } : {}) };
                    if (await context.checkpoint(action.seconds, snapshot)) return { paused: true };
                }
                await context.wait(action.seconds); break;
            }
            case 'schedule_message': await context.scheduleMessage(action.seconds, action.channelId, interpolate(action.message)); break;
            case 'set_variable': variables[action.name] = interpolate(action.value); break;
            case 'check': {
                const c = action.condition;
                let ok;
                if (c.type === 'has_role') ok = await context.hasRole(c.roleId);
                else if (c.type === 'variable_exists') ok = Object.hasOwn(variables, c.name);
                else if (!Object.hasOwn(variables, c.name)) ok = false;
                else {
                    const expected = interpolate(c.value), actual = variables[c.name];
                    ok = c.type === 'variable_equals' ? actual === expected : c.type === 'variable_not_equals' ? actual !== expected : actual.includes(expected);
                }
                pending = [...(ok ? action.then : action.else), ...pending];
                break;
            }
            case 'add_role': case 'remove_role': case 'toggle_role': await context.changeRole(action.type, action.roleId); break;
            case 'select_unique_role': await context.selectUniqueRole(action.roleId, action.roleIds); break;
            case 'send_message': case 'send_webhook_message': lastMessage = action.templateId ? await context.sendTemplate(action.templateId, action.private, action.channelId) : await context.send(action.type, action.channelId, interpolate(action.message)); break;
            case 'create_thread': await context.createThread(action.channelId, interpolate(action.name)); break;
            case 'delete_message': if (!lastMessage) throw new Error('Tidak ada pesan yang dibuat flow ini untuk dihapus.'); await context.deleteMessage(lastMessage); lastMessage = null; break;
            default: throw fail('Action flow tidak dikenal.');
        }
    }
}

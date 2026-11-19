// Converts a deliberately limited subset of raw Discord Components V2 into Studio documents.
// Foreign interaction IDs and flow definitions are never executed or retained.
import { normalizeMessageDocument } from './messageStudio.js';

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: 'MESSAGE_STUDIO_IMPORT_INVALID' });
const object = (v, fields, label) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !fields.includes(k))) throw invalid(`${label} memiliki format atau properti yang belum didukung.`);
};
const array = (v, max, label) => { if (!Array.isArray(v) || !v.length || v.length > max) throw invalid(`${label} tidak valid atau melebihi batas.`); return v; };
const emoji = (value) => {
    if (value == null) return null;
    object(value, ['id', 'name', 'animated'], 'Emoji');
    if (value.id != null) {
        if (!/^\d{17,20}$/.test(value.id) || typeof value.name !== 'string' || !/^\w{2,32}$/.test(value.name) || (value.animated !== undefined && typeof value.animated !== 'boolean')) throw invalid('Emoji kustom tidak valid.');
        return `<${value.animated ? 'a' : ''}:${value.name}:${value.id}>`;
    }
    if (typeof value.name !== 'string' || value.animated) throw invalid('Emoji tidak valid.');
    return value.name;
};

export function importDiscordMessage(raw) {
    object(raw, ['components', 'flags', 'attachments', 'username', 'avatar_url'], 'Pesan');
    if (raw.username !== undefined && (typeof raw.username !== 'string' || raw.username.length > 80)) throw invalid('Nama pengirim tidak valid.');
    if (raw.avatar_url !== undefined && (typeof raw.avatar_url !== 'string' || raw.avatar_url.length > 2000 || !/^https:\/\//i.test(raw.avatar_url))) throw invalid('URL avatar tidak valid.');
    if (raw.flags !== undefined && raw.flags !== 32768) throw invalid('Flag pesan tidak didukung; gunakan Components V2 tanpa flag lain.');
    if (raw.attachments !== undefined && (!Array.isArray(raw.attachments) || raw.attachments.length)) throw invalid('Attachment tidak dapat diimpor; unggah file ulang di composer.');
    const top = array(raw.components, 30, 'Komponen');
    let counter = 0, interactions = false, placeholderLabel = false;
    const id = () => `import${++counter}`;
    const source = (media) => {
        object(media, ['url'], 'Media');
        if (typeof media.url !== 'string' || !/^https:\/\//i.test(media.url)) throw invalid('Media harus berupa URL HTTPS; attachment harus diunggah ulang.');
        return { kind: 'url', url: media.url };
    };
    const item = (entry) => {
        object(entry, ['media', 'description', 'spoiler'], 'Item media');
        return { id: id(), source: source(entry.media), description: entry.description ?? null, spoiler: entry.spoiler ?? false };
    };
    const block = (entry, inside) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid('Komponen tidak valid.');
        const blockId = id();
        if (entry.type === 10) { object(entry, ['type', 'id', 'content'], 'Text Display'); return { id: blockId, type: 'text', content: entry.content }; }
        if (entry.type === 14) { object(entry, ['type', 'id', 'divider', 'spacing'], 'Separator'); return { id: blockId, type: 'separator', divider: entry.divider ?? true, spacing: entry.spacing ?? 1 }; }
        if (entry.type === 12) { object(entry, ['type', 'id', 'items'], 'Media Gallery'); return { id: blockId, type: 'media', items: array(entry.items, 10, 'Media Gallery').map(item) }; }
        if (entry.type === 9 && inside) {
            object(entry, ['type', 'id', 'components', 'accessory'], 'Section');
            const texts = array(entry.components, 1, 'Teks section'); object(texts[0], ['type', 'id', 'content'], 'Teks section');
            if (texts[0].type !== 10) throw invalid('Section hanya mendukung satu Text Display dan thumbnail.');
            const thumb = entry.accessory; object(thumb, ['type', 'id', 'media', 'description', 'spoiler'], 'Thumbnail');
            if (thumb.type !== 11) throw invalid('Section hanya mendukung thumbnail.');
            return { id: blockId, type: 'section', content: texts[0].content, items: [item({ media: thumb.media, description: thumb.description, spoiler: thumb.spoiler })] };
        }
        if (entry.type === 1) {
            object(entry, ['type', 'id', 'components'], 'Action Row');
            const children = array(entry.components, 5, 'Action Row');
            if (children.every(c => c?.type === 2)) return { id: blockId, type: 'buttons', buttons: children.map(button => {
                object(button, ['type', 'id', 'style', 'label', 'emoji', 'url', 'custom_id', 'disabled', 'flow'], 'Tombol');
                const style = { 1: 'primary', 2: 'secondary', 3: 'success', 4: 'danger', 5: 'link' }[button.style];
                if (!style || (button.label !== undefined && (typeof button.label !== 'string' || !button.label.trim()))) throw invalid('Label atau gaya tombol tidak valid.');
                if (!button.label) placeholderLabel = true;
                const base = { id: id(), label: button.label || 'Tombol impor', style, emoji: emoji(button.emoji), disabled: button.disabled ?? false };
                if (style === 'link') { if (button.custom_id !== undefined || button.flow !== undefined) throw invalid('Tombol link tidak boleh memiliki flow atau custom_id.'); return { ...base, url: button.url }; }
                if (button.url !== undefined) throw invalid('Tombol interaktif tidak boleh memiliki URL.');
                interactions = true;
                return { ...base, disabled: true, response: 'Tombol impor belum dikonfigurasi.' };
            }) };
            if (children.length !== 1) throw invalid('Action Row menu hanya boleh berisi satu menu.');
            const menu = children[0];
            object(menu, ['type', 'id', 'custom_id', 'placeholder', 'min_values', 'max_values', 'options', 'flow'], 'Menu');
            if (menu.type !== 3) throw invalid('Jenis menu ini belum didukung importer.');
            interactions = true;
            return { id: blockId, type: 'select', placeholder: menu.placeholder ?? null, minValues: menu.min_values ?? 1, maxValues: menu.max_values ?? 1, options: array(menu.options, 25, 'Opsi menu').map(option => {
                object(option, ['label', 'value', 'description', 'emoji', 'default', 'flow'], 'Opsi menu');
                if (option.default === true) throw invalid('Pilihan default menu belum didukung; hapus default sebelum import.');
                if (option.default !== undefined && option.default !== false) throw invalid('Pilihan default tidak valid.');
                return { id: id(), label: option.label, description: option.description ?? null, emoji: emoji(option.emoji), response: 'Pilihan impor belum dikonfigurasi.' };
            }) };
        }
        throw invalid(`Komponen Discord tipe ${Number.isInteger(entry.type) ? entry.type : '?'} belum didukung${inside ? ' di dalam container' : ''}.`);
    };
    const document = { version: 1, containers: [], before: [], after: [], order: [] };
    for (const entry of top) {
        if (entry?.type === 17) {
            object(entry, ['type', 'id', 'accent_color', 'spoiler', 'components'], 'Container');
            if (entry.accent_color != null && (!Number.isInteger(entry.accent_color) || entry.accent_color < 0 || entry.accent_color > 0xffffff)) throw invalid('Warna container tidak valid.');
            const container = { id: id(), accentColor: entry.accent_color == null ? null : `#${entry.accent_color.toString(16).padStart(6, '0')}`, spoiler: entry.spoiler ?? false, blocks: array(entry.components, 10, 'Container').map(c => block(c, true)) };
            document.containers.push(container); document.order.push({ kind: 'container', id: container.id });
        } else {
            const component = block(entry, false); document.before.push(component); document.order.push({ kind: 'block', id: component.id });
        }
    }
    const warnings = [];
    if (interactions) warnings.push('Flow dan custom_id asing diabaikan. Tombol interaktif dinonaktifkan; menu menggunakan respons sementara. Atur ulang action sebelum digunakan.');
    if (placeholderLabel) warnings.push('Tombol tanpa label diberi label sementara “Tombol impor”; periksa dan ubah sebelum digunakan.');
    if (raw.username !== undefined || raw.avatar_url !== undefined) warnings.push('Nama dan avatar pengirim dari JSON diabaikan; atur pengirim sendiri di dashboard.');
    return { document: normalizeMessageDocument(document), warnings };
}

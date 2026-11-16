// notation.js — how counter numbers are written, and how a free-form counter name is read and rewritten.
//
// Admins may rename a counter channel to anything they like, as long as a number stays in it
// ("Anggota: 1.234", "🚀 Boosts 10K"). The bot keeps their text and replaces only that number.
// When there is no number to replace (or the result would exceed Discord's name limit) the
// bot falls back to the default "<BaseName>-<count>" template.
//
// Notation is a per-guild choice stored next to the counters:
//   plain   1211
//   dot     1.211   (Indonesian thousand separator)
//   comma   1,211   (English thousand separator)
//   compact 1.21K   (compact, e.g. Intl.NumberFormat('en', { notation: 'compact' }))

export const NOTATIONS = ['plain', 'dot', 'comma', 'compact'];
export const DEFAULT_NOTATION = 'plain';
export const notationOrDefault = (value) => (NOTATIONS.includes(value) ? value : DEFAULT_NOTATION);

/** The number as it is written in the channel name. */
export function formatCount(count, notation = DEFAULT_NOTATION) {
    const value = Number(count);
    if (!Number.isFinite(value)) return String(count ?? '');
    switch (notationOrDefault(notation)) {
        case 'dot': return Math.round(value).toLocaleString('id-ID');
        case 'comma': return Math.round(value).toLocaleString('en-US');
        case 'compact':
            return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
        default: return String(Math.round(value));
    }
}

/** Interpret one number literal as written in a channel name. Grouping style is sniffed from the separator positions. */
export function parseCountLiteral(literal) {
    const text = String(literal ?? '').trim();
    if (!text) return null;
    const match = /^(\d[\d.,]*)([kKmM])?$/.exec(text);
    if (!match) return null;
    const [, digitsPart, suffix] = match;
    let multiplier = 1;
    if (suffix) multiplier = suffix.toLowerCase() === 'k' ? 1_000 : 1_000_000;

    const lastSep = Math.max(digitsPart.lastIndexOf(','), digitsPart.lastIndexOf('.'));
    let normalized;
    if (lastSep === -1) {
        normalized = digitsPart;
    } else {
        const groups = digitsPart.split(/[.,]/);
        const isGrouping = groups.length > 1 && groups.slice(1).every((group) => /^\d{3}$/.test(group));
        if (isGrouping) {
            normalized = digitsPart.replace(/[.,]/g, '');
        } else {
            const decimals = digitsPart.slice(lastSep + 1);
            normalized = `${digitsPart.slice(0, lastSep).replace(/[.,]/g, '')}.${decimals}`;
        }
    }
    const value = Number(normalized) * multiplier;
    return Number.isFinite(value) ? Math.round(value) : null;
}

/** Every number in a channel name, with its position (a K/M suffix belongs to the number before it). */
export function findNumbers(text) {
    const out = [];
    const pattern = /(\d[\d.,]*\d|\d)([kKmM])?/g;
    let match;
    while ((match = pattern.exec(String(text ?? ''))) !== null) {
        const raw = match[0];
        const value = parseCountLiteral(raw);
        if (value === null) continue;
        out.push({ start: match.index, end: match.index + raw.length, raw, value });
    }
    return out;
}

/** The side that wins when two numbers are equally good candidates; the count of a goal name is the first number, so those ties go left. */
export const TIE_BREAK = ['leftmost', 'rightmost'];

/**
 * The number in `name` to replace for a counter that should show `count`.
 * Candidates within ~2% of `preferred` (the number the bot itself wrote earlier) win; among
 * them the rightmost is used (the stale count usually trails its unit word). Without a preference,
 * the number closest to the current count wins; rightmost on a tie. `tieBreak: 'leftmost'` flips
 * the tie-break for goal names, where the progress number always comes first. Returns null when the name has no number.
 */
export function pickNumber(name, count, preferred = null, tieBreak = 'rightmost') {
    const candidates = findNumbers(name);
    if (!candidates.length) return null;
    const pickTie = (list) => (tieBreak === 'leftmost' ? list[0] : list[list.length - 1]);
    if (Number.isFinite(preferred)) {
        const tolerance = Math.max(1, Math.abs(preferred) * 0.02);
        const exact = candidates.filter((candidate) => Math.abs(candidate.value - preferred) <= tolerance);
        if (exact.length) return pickTie(exact);
    }
    if (candidates.length === 1) return candidates[0];
    const target = Number.isFinite(Number(count)) ? Number(count) : 0;
    return candidates.reduce((best, candidate) => {
        const distance = Math.abs(candidate.value - target);
        const bestDistance = Math.abs(best.value - target);
        if (distance < bestDistance) return candidate;
        if (distance === bestDistance && (tieBreak === 'leftmost' ? candidate.start < best.start : candidate.start > best.start)) return candidate;
        return best;
    });
}

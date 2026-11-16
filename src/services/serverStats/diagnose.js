// diagnose.js — a read-only health check of the counters, the reference /check, local flavour.
//
// It answers: does the bot see every counter channel, may it rename them, can the
// numbers be computed right now, and are the stored entries usable at all. Nothing
// is written, created or renamed; the only network traffic is what reading needs.

import { logger } from '../../utils/logger.js';
import { computeCounterName, computeGoalName, getRoleCounterBaseName } from '../serverstatsService.js';
import { COUNTER_TYPES, PRESENCE_TYPES, readCounters } from './store.js';
import { externalBaseName, gatherExternalCounts, missingSocialKeys } from './external.js';
import {
    botCanManageChannel, countFor, counterRefresher, findChannel, gatherCounterStats, statTypeOf,
} from './refresh.js';

const MEMBER_LIST_TYPES = new Set(['bots', 'members_only', 'pending', 'norole', 'role']);
const EMOJI_TYPES = new Set(['emojis', 'static_emojis', 'animated_emojis']);

const REASON_TEXT = {
    missing: 'Channel tidak terlihat oleh bot atau sudah dihapus di Discord; catatannya akan dibersihkan oleh pengecekan terjadwal.',
    no_permission: 'Bot tidak dapat mengganti nama channel ini (butuh izin View Channel dan Manage Channels).',
    member_list: 'Daftar anggota tidak dapat diambil — periksa izin intent Guild Members (privileged) di Discord Developer Portal.',
    bans: 'Daftar ban tidak dapat dibaca oleh bot.',
    emojis: 'Emoji atau sticker server tidak dapat diambil.',
    count_unknown: 'Angka ini belum dapat diketahui saat ini.',
    disabled: 'Counter nonaktif; tidak diperbarui sampai diaktifkan lagi.',
    rename_pending: 'Menunggu batas ganti nama Discord; nama channel menyusul.',
    stale: 'Nama channel belum mengikuti jumlah terkini; akan disesuaikan pada penyegaran berikutnya.',
    role_missing: 'Role untuk counter ini sudah tidak ada di server; hapus counternya atau buat yang baru untuk role lain.',
    presence: 'Status anggota tidak bisa dibaca. Aktifkan Presence Intent di Discord Developer Portal (Bot → Privileged Gateway Intents) lalu set ZENTIX_PRESENCE_INTENT=1 di .env dan restart bot.',
    external_key: 'Counter sosial ini butuh kunci API yang belum ada di .env. Isi kuncinya lalu mulai ulang bot; tanpa itu angkanya memang tidak bisa dibaca.',
    external: 'Angka di luar Discord belum bisa diambil sekarang (host tidak menjawab, kunci ditolak, atau jaringan bermasalah). Coba lagi nanti; pastikan konfigurasinya benar di dashboard.',
    rejected: 'entri tersimpan tidak dapat dibaca dan tidak akan ditampilkan atau diubah.',
};

/** Probe whether the member list is fetchable at all (privileged intent). One member is enough. */
async function probeMemberList(guild) {
    if (typeof guild?.members?.fetch !== 'function') return 'failed';
    try {
        await guild.members.fetch({ limit: 1, time: 10_000 });
        return 'ok';
    } catch (error) {
        logger.warn(`[SERVERSTATS] Member list probe for guild ${guild?.id} failed: ${error?.message ?? error}`);
        return 'failed';
    }
}

function issueFor(type, count, counter = null) {
    if (count !== null) return null;
    if (type === 'game' || type === 'social') {
        if (type === 'social' && missingSocialKeys(counter?.social?.platform).length) return 'external_key';
        return 'external';
    }
    if (PRESENCE_TYPES.has(type)) return 'presence';
    if (MEMBER_LIST_TYPES.has(type)) return 'member_list';
    if (type === 'bans') return 'bans';
    if (EMOJI_TYPES.has(type) || type === 'stickers') return 'emojis';
    return 'count_unknown';
}

/**
 * A read-only report on the counters of a guild.
 * `{ ok, rejected, memberList, counters: [{ id, type, channelId, level, issue, text }], renamePending }`
 * `ok` is false when at least one counter has an `error` issue.
 */
export async function diagnoseCounters(client, guild, { refresher = counterRefresher } = {}) {
    const { counters, rejected, notation } = await readCounters(client, guild.id);
    const active = counters.filter((counter) => counter.enabled !== false);
    const stats = await gatherCounterStats(guild, active.filter((counter) => COUNTER_TYPES.includes(counter.type) && counter.type !== 'game' && counter.type !== 'social'));
    // /check is a health read for the owner: it reads the outside sources fresh, not the 5-minute cache.
    const externalCounts = await gatherExternalCounts(active, { fresh: true, guildId: guild.id });

    // The probe only runs when a counter needs the member list; otherwise it stays 'not_needed'.
    const memberList = active.some((counter) => MEMBER_LIST_TYPES.has(statTypeOf(counter))) ? await probeMemberList(guild) : 'not_needed';

    const out = [];
    let renamePending = 0;
    for (const counter of counters) {
        const entry = { id: counter.id, type: counter.type, channelId: counter.channelId };
        if (counter.enabled === false) {
            out.push({ ...entry, level: 'info', issue: 'disabled', text: REASON_TEXT.disabled });
            continue;
        }
        const known = COUNTER_TYPES.includes(counter.type);
        const found = await findChannel(guild, counter.channelId);
        if (!found.channel) {
            out.push({ ...entry, level: 'error', issue: 'missing', text: REASON_TEXT.missing });
            continue;
        }
        if (known && !botCanManageChannel(guild, found.channel)) {
            out.push({ ...entry, level: 'error', issue: 'no_permission', text: REASON_TEXT.no_permission });
            continue;
        }
        if (!known) {
            out.push({ ...entry, level: 'warn', issue: 'count_unknown', text: REASON_TEXT.count_unknown });
            continue;
        }
        if (counter.type === 'role') {
            const role = guild?.roles?.cache?.get?.(counter.roleId);
            if (!role) {
                out.push({ ...entry, level: 'error', issue: 'role_missing', text: REASON_TEXT.role_missing });
                continue;
            }
        }
        const statType = statTypeOf(counter);
        const isExternal = counter.type === 'game' || counter.type === 'social';
        const count = isExternal
            ? (externalCounts.get(counter.id) ?? null)
            : countFor(statType, stats, counter.roleId ?? null);
        if (count === null) {
            const issue = issueFor(statType, count, counter);
            out.push({ ...entry, level: 'error', issue, text: REASON_TEXT[issue] });
            continue;
        }
        const current = String(found.channel.name ?? '');
        const baseName = counter.type === 'role'
            ? getRoleCounterBaseName(guild?.roles?.cache?.get?.(counter.roleId)?.name)
            : (isExternal ? externalBaseName(counter) : null);
        const expectedName = counter.type === 'goal'
            ? computeGoalName(current, count, counter.goal, notation, counter.goalStat).name
            : computeCounterName(current, statType, count, notation, null, baseName).name;
        if (refresher.showsName(found.channel, expectedName)) continue; // nothing owed
        const nextRenameAt = refresher.nextRenameAt?.(counter.channelId) ?? null;
        if (nextRenameAt) {
            renamePending += 1;
            out.push({ ...entry, level: 'info', issue: 'rename_pending', text: REASON_TEXT.rename_pending, nextRenameAt });
        } else {
            out.push({ ...entry, level: 'info', issue: 'stale', text: REASON_TEXT.stale });
        }
    }

    // An error on any member-requiring counter plus a failed probe is one story: name it once.
    if (memberList === 'failed') {
        out.push({ id: null, type: null, channelId: null, level: 'error', issue: 'member_list', text: REASON_TEXT.member_list });
    }

    const ok = !out.some((entry) => entry.level === 'error');
    return { ok, rejected, notation, memberList, counters: out, renamePending, checked: counters.length };
}


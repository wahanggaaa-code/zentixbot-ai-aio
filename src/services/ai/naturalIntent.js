import { PermissionFlagsBits } from 'discord.js';
import botConfig, { isBotOwner, isCommandCategoryEnabled, isMaintenanceMode } from '../../config/bot.js';
import { pgConfig } from '../../config/database/postgres.js';
import { sqliteBackend } from '../storage/sqlite.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { isCommandEnabledInConfig } from '../commandAccessService.js';
import { getPrefixRestriction } from '../../config/commands/prefixRestrictions.js';
import { resolveSubcommandAlias } from '../../config/commands/commandAliases.js';
import { executePrefixCommand, supportsPrefixExecution } from '../../utils/messageAdapter.js';
import { enforceAbuseProtection } from '../../utils/abuseProtection.js';
import { getCommandDefaultPermissions, memberMeetsCommandPermissions } from '../../utils/permissionGuard.js';
import { isRestrictedCommand, memberHasRestrictedAccess } from '../../utils/restrictedCommands.js';
import { resolveTimeZone } from '../../commands/Tools/time.js';
import { buildQueueReply } from '../music/musicActions.js';

// Explicit, audited actions only: never dispatch arbitrary names, subcommands or model output.
export const SAFE_INTENT_COMMANDS = Object.freeze(['firstmsg', 'rank', 'leaderboard', 'nowplaying', 'weather', 'define', 'search', 'urban', 'birthday info', 'birthday list', 'birthday next', 'time', 'support', 'personal', 'queue', 'serverinfo', 'userinfo', 'uptime']);
export const SAFE_INTENT_HANDOFFS = Object.freeze(['terjemahkan', 'help', 'play', 'play-mood', 'gambar', 'drafbug', 'poll', 'aichat', 'music pause', 'music resume', 'music skip', 'birthday set', 'birthday remove', 'report file', 'warnings', 'warn', 'ban', 'kick', 'timeout', 'unban', 'untimeout', 'purge', 'lock', 'unlock', 'claim', 'close', 'priority', 'transfer-ticket', 'ticket-summary', 'ticket-priority-ai', 'ticket-sentiment-ai', 'ticket-faq-draft', 'ticket dashboard', 'logging dashboard', 'level dashboard', 'jointocreate dashboard', 'commands dashboard', 'configwizard', 'commands enable', 'commands disable', 'birthday setchannel', 'report setchannel', 'ticket setup', 'logging channel', 'level setup', 'jointocreate setup', 'gcreate', 'gdelete', 'gend', 'greroll', 'dm', 'massban', 'masskick', 'music stop', 'music shuffle', 'music loop', 'music volume', 'music seek', 'music remove', 'music move', 'music clear', 'music leave', 'music 247', 'personal', 'wipedata']);
export const PRIVATE_INTENT_COMMANDS = Object.freeze(['time', 'support', 'personal', 'queue', 'serverinfo', 'userinfo', 'uptime']);
const TRANSLATE = /^(?:(?:tolong|coba|please|bisa|boleh|mohon)\s+){0,2}(?:terjemah(?:kan|in)?|translate|alih\s+bahasa)(?=$|[^\p{L}\p{N}])/iu;
const HANDOFFS = [
    ['configwizard', /^(?:(?:tolong|coba|please)\s+)?(?:buka wizard konfigurasi|buka wizard setup|open configuration wizard)[?.!]*$/iu],
    ['commands enable', /^(?:(?:tolong|coba|please)\s+)?(?:aktifkan command|aktifkan perintah|enable a command)[?.!]*$/iu],
    ['commands disable', /^(?:(?:tolong|coba|please)\s+)?(?:nonaktifkan command|nonaktifkan perintah|disable a command)[?.!]*$/iu],
    ['birthday setchannel', /^(?:(?:tolong|coba|please)\s+)?(?:atur channel ulang tahun|set birthday channel)[?.!]*$/iu],
    ['report setchannel', /^(?:(?:tolong|coba|please)\s+)?(?:atur channel laporan|set report channel)[?.!]*$/iu],
    ['ticket setup', /^(?:(?:tolong|coba|please)\s+)?(?:atur sistem tiket|setup ticket system)[?.!]*$/iu],
    ['logging channel', /^(?:(?:tolong|coba|please)\s+)?(?:atur channel logging|configure logging channel)[?.!]*$/iu],
    ['level setup', /^(?:(?:tolong|coba|please)\s+)?(?:atur sistem level|setup leveling system)[?.!]*$/iu],
    ['jointocreate setup', /^(?:(?:tolong|coba|please)\s+)?(?:atur join to create|setup join to create)[?.!]*$/iu],
    ['gcreate', /^(?:(?:tolong|coba|please)\s+)?(?:buat giveaway|create a giveaway)[?.!]*$/iu],
    ['gdelete', /^(?:(?:tolong|coba|please)\s+)?(?:hapus giveaway|delete a giveaway)[?.!]*$/iu],
    ['gend', /^(?:(?:tolong|coba|please)\s+)?(?:akhiri giveaway|end a giveaway)[?.!]*$/iu],
    ['greroll', /^(?:(?:tolong|coba|please)\s+)?(?:undi ulang giveaway|reroll a giveaway)[?.!]*$/iu],
    ['dm', /^(?:(?:tolong|coba|please)\s+)?(?:kirim dm ke anggota|send a dm to a member)[?.!]*$/iu],
    ['massban', /^(?:(?:tolong|coba|please)\s+)?(?:ban anggota massal|mass ban users)[?.!]*$/iu],
    ['masskick', /^(?:(?:tolong|coba|please)\s+)?(?:kick anggota massal|mass kick users)[?.!]*$/iu],
    ['music stop', /^(?:(?:tolong|coba|please)\s+)?(?:hentikan musik|hentikan pemutaran musik|stop music|stop playback)[?.!]*$/iu],
    ['music shuffle', /^(?:(?:tolong|coba|please)\s+)?(?:acak antrean musik|acak antrian musik|shuffle music queue)[?.!]*$/iu],
    ['music loop', /^(?:(?:tolong|coba|please)\s+)?(?:atur pengulangan musik|atur loop musik|set music loop)[?.!]*$/iu],
    ['music volume', /^(?:(?:tolong|coba|please)\s+)?(?:atur volume musik|set music volume)[?.!]*$/iu],
    ['music seek', /^(?:(?:tolong|coba|please)\s+)?(?:atur posisi lagu|seek music)[?.!]*$/iu],
    ['music remove', /^(?:(?:tolong|coba|please)\s+)?(?:hapus lagu dari antrean|hapus lagu dari antrian|remove a song from queue)[?.!]*$/iu],
    ['music move', /^(?:(?:tolong|coba|please)\s+)?(?:pindahkan lagu di antrean|pindahkan lagu di antrian|move a song in queue)[?.!]*$/iu],
    ['music clear', /^(?:(?:tolong|coba|please)\s+)?(?:hapus antrean lagu|hapus antrian lagu|clear music queue)[?.!]*$/iu],
    ['music leave', /^(?:(?:tolong|coba|please)\s+)?(?:keluarkan bot dari voice|disconnect bot from voice)[?.!]*$/iu],
    ['music 247', /^(?:(?:tolong|coba|please)\s+)?(?:atur mode musik 24 jam|set music 24 7 mode)[?.!]*$/iu],
    ['personal', /^(?:(?:tolong|coba|please)\s+)?(?:ubah bahasa pribadi saya|hapus bahasa pribadi saya|change my personal language|reset my personal language)[?.!]*$/iu],
    ['wipedata', /^(?:(?:tolong|coba|please)\s+)?(?:hapus data pribadi saya|hapus data bot saya|delete my bot data)[?.!]*$/iu],
    ['birthday remove', /^(?:(?:tolong|coba|please)\s+)?(?:hapus ulang tahun saya|hapus tanggal lahir saya|remove my birthday)[?.!]*$/iu],
    ['report file', /^(?:(?:tolong|coba|please)\s+)?(?:laporkan pengguna|buat laporan pengguna|report a user)[?.!]*$/iu],
    ['warnings', /^(?:(?:tolong|coba|please)\s+)?(?:lihat peringatan pengguna|cek peringatan pengguna|view user warnings)[?.!]*$/iu],
    ['warn', /^(?:(?:tolong|coba|please)\s+)?(?:beri peringatan pengguna|warn a user)[?.!]*$/iu],
    ['ban', /^(?:(?:tolong|coba|please)\s+)?(?:ban pengguna|ban a user)[?.!]*$/iu],
    ['kick', /^(?:(?:tolong|coba|please)\s+)?(?:kick pengguna|kick a user)[?.!]*$/iu],
    ['timeout', /^(?:(?:tolong|coba|please)\s+)?(?:timeout pengguna|timeout a user)[?.!]*$/iu],
    ['unban', /^(?:(?:tolong|coba|please)\s+)?(?:buka ban pengguna|unban a user)[?.!]*$/iu],
    ['untimeout', /^(?:(?:tolong|coba|please)\s+)?(?:hapus timeout pengguna|remove user timeout)[?.!]*$/iu],
    ['purge', /^(?:(?:tolong|coba|please)\s+)?(?:hapus pesan massal|bersihkan pesan massal|bulk delete messages)[?.!]*$/iu],
    ['lock', /^(?:(?:tolong|coba|please)\s+)?(?:kunci channel|lock this channel)[?.!]*$/iu],
    ['unlock', /^(?:(?:tolong|coba|please)\s+)?(?:buka kunci channel|unlock this channel)[?.!]*$/iu],
    ['claim', /^(?:(?:tolong|coba|please)\s+)?(?:klaim tiket ini|claim this ticket)[?.!]*$/iu],
    ['close', /^(?:(?:tolong|coba|please)\s+)?(?:tutup tiket ini|close this ticket)[?.!]*$/iu],
    ['priority', /^(?:(?:tolong|coba|please)\s+)?(?:ubah prioritas tiket|change ticket priority)[?.!]*$/iu],
    ['transfer-ticket', /^(?:(?:tolong|coba|please)\s+)?(?:transfer tiket ini|transfer this ticket)[?.!]*$/iu],
    ['ticket-summary', /^(?:(?:tolong|coba|please)\s+)?(?:ringkas tiket ini dengan ai|summarize this ticket with ai)[?.!]*$/iu],
    ['ticket-priority-ai', /^(?:(?:tolong|coba|please)\s+)?(?:analisis prioritas tiket dengan ai|analyze ticket priority with ai)[?.!]*$/iu],
    ['ticket-sentiment-ai', /^(?:(?:tolong|coba|please)\s+)?(?:analisis sentimen tiket dengan ai|analyze ticket sentiment with ai)[?.!]*$/iu],
    ['ticket-faq-draft', /^(?:(?:tolong|coba|please)\s+)?(?:buat draf faq tiket|draft ticket faq)[?.!]*$/iu],
    ['ticket dashboard', /^(?:(?:tolong|coba|please)\s+)?(?:buka dashboard tiket|open ticket dashboard)[?.!]*$/iu],
    ['logging dashboard', /^(?:(?:tolong|coba|please)\s+)?(?:buka dashboard logging|open logging dashboard)[?.!]*$/iu],
    ['level dashboard', /^(?:(?:tolong|coba|please)\s+)?(?:buka dashboard level|open level dashboard)[?.!]*$/iu],
    ['jointocreate dashboard', /^(?:(?:tolong|coba|please)\s+)?(?:buka dashboard join to create|open join to create dashboard)[?.!]*$/iu],
    ['commands dashboard', /^(?:(?:tolong|coba|please)\s+)?(?:buka dashboard akses command|open command access dashboard)[?.!]*$/iu],
    ['music pause', /^(?:(?:tolong|coba|please)\s+)?(?:jeda musik|jeda lagu|pause music|pause the music)[?.!]*$/iu],
    ['music resume', /^(?:(?:tolong|coba|please)\s+)?(?:lanjutkan musik|lanjutkan lagu|resume music|resume the music)[?.!]*$/iu],
    ['music skip', /^(?:(?:tolong|coba|please)\s+)?(?:lewati lagu|skip lagu|skip this song|skip the song)[?.!]*$/iu],
    ['birthday set', /^(?:(?:tolong|coba|please)\s+)?(?:atur ulang tahun saya|simpan ulang tahun saya|set my birthday)[?.!]*$/iu],
    ['play', /^(?:(?:tolong|coba|please)\s+)?(?:putar lagu|mainkan lagu|play a song)[?.!]*$/iu],
    ['play-mood', /^(?:(?:tolong|coba|please)\s+)?(?:putar musik sesuai suasana|mainkan musik sesuai suasana|play music by mood)[?.!]*$/iu],
    ['gambar', /^(?:(?:tolong|coba|please)\s+)?(?:buat gambar ai|generate an ai image|create an ai image)[?.!]*$/iu],
    ['drafbug', /^(?:(?:tolong|coba|please)\s+)?(?:buat draf laporan bug|buat draft laporan bug|create a bug report draft)[?.!]*$/iu],
    ['poll', /^(?:(?:tolong|coba|please)\s+)?(?:buat polling|buat poll|create a poll)[?.!]*$/iu],
    ['aichat', /^(?:(?:tolong|coba|please)\s+)?(?:buka chat ai privat|chat ai lewat dm|open private ai chat)[?.!]*$/iu],
    ['help', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|tampilkan|show)\s+(?:daftar perintah|daftar command|command list|help menu)[?.!]*$/iu],
];
const COMMANDS = [
    ['rank', /^(?:cek level saya|lihat level saya|berapa level saya|level saya berapa|berapa xp saya|cek xp saya|lihat xp saya|what is my level|how much xp do i have)[?.!]*$/iu],
    ['leaderboard', /^(?:siapa peringkat teratas|siapa yang paling tinggi levelnya|show top levels)[?.!]*$/iu],
    ['nowplaying', /^(?:musik apa yang sedang diputar|lagu apa yang lagi diputar|what song is playing now)[?.!]*$/iu],
    ['birthday next', /^(?:siapa yang ulang tahun selanjutnya|siapa ulang tahun selanjutnya|who is next to have a birthday)[?.!]*$/iu],
    ['queue', /^(?:apa isi antrean lagu|apa isi antrian lagu|apa isi antrean musik|what songs are in the queue)[?.!]*$/iu],
    ['firstmsg', /^(?:pesan paling awal di channel ini|apa pesan paling awal di channel ini|what was the first message in this channel)[?.!]*$/iu],
    ['firstmsg', /^(?:pesan pertama (?:di channel ini|di sini)|apa pesan pertama di channel ini)[?.!]*$/iu],
    ['rank', /^(?:peringkat saya berapa|berapa peringkat saya|what is my ranking)[?.!]*$/iu],
    ['leaderboard', /^(?:siapa yang ada di leaderboard|tampilkan peringkat teratas|show the leaderboard)[?.!]*$/iu],
    ['nowplaying', /^(?:sekarang lagu apa|lagu apa sekarang|what song is playing)[?.!]*$/iu],
    ['birthday info', /^(?:kapan ulang tahun saya|kapan ulang tahunku|when is my birthday)[?.!]*$/iu],
    ['birthday list', /^(?:siapa saja yang ulang tahun|show birthday list)[?.!]*$/iu],
    ['birthday next', /^(?:ulang tahun berikutnya siapa|who has the next birthday)[?.!]*$/iu],
    ['queue', /^(?:apa saja antrean lagu|apa saja antrian lagu|what is in the music queue)[?.!]*$/iu],
    ['time', /^(?:sekarang jam berapa|jam sekarang berapa|what is the current time)[?.!]*$/iu],
    ['personal', /^(?:apa bahasa pribadi saya|apa bahasa pribadiku|what is my personal language)[?.!]*$/iu],
    ['serverinfo', /^(?:apa info server ini|apa informasi server ini|what is this server info)[?.!]*$/iu],
    ['userinfo', /^(?:apa info akun saya|apa info saya|what is my account info)[?.!]*$/iu],
    ['support', /^(?:lihat kontak owner bot|cara menghubungi owner bot|show bot owner contact)[?.!]*$/iu],
    ['uptime', /^(?:berapa uptime bot|what is the bot uptime)[?.!]*$/iu],
    ['uptime', /^(?:(?:tolong|coba|please)\s+)?(?:cek|lihat|tampilkan|check|show)\s+(?:uptime bot|kesehatan bot|bot uptime|bot health)[?.!]*$/iu],
    ['serverinfo', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|cek|tampilkan|show|check)\s+(?:info(?:rmasi)? server(?: ini)?|server info(?:rmation)?|this server(?:'s)? info)[?.!]*$/iu],
    ['userinfo', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|cek|tampilkan|show|check)\s+(?:info(?:rmasi)? (?:saya|aku|akun saya)|my (?:user |account )?info(?:rmation)?)[?.!]*$/iu],
    ['queue', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|tampilkan|show)\s+(?:antrean lagu|antrian lagu|music queue|the queue)[?.!]*$/iu],
    ['personal', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|cek|tampilkan|show|check)\s+(?:bahasa pribadi saya|bahasa pribadiku|my personal language)[?.!]*$/iu],
    ['support', /^(?:(?:tolong|coba|please)\s+)?(?:hubungi owner bot|kontak owner bot|contact bot owner)[?.!]*$/iu],
    ['time', /^(?:(?:tolong|coba|please)\s+)?(?:jam berapa(?: sekarang)?|waktu sekarang|what time is it)[?.!]*$/iu],
    ['firstmsg', /^(?:(?:tolong|coba|please)\s+)?(?:cari|lihat|tampilkan|show|find)\s+(?:pesan pertama(?: di (?:channel|sini))?|first message(?: in (?:this channel|here))?)[?.!]*$/iu],
    ['firstmsg', /^(?:(?:tolong|coba|please)\s+)?apa pesan pertama(?: di (?:channel ini|sini))?[?.!]*$/iu],
    ['rank', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|cek|tampilkan|show|check)\s+(?:rank(?:ing)?(?: saya| aku|ku)?|peringkat(?: saya| aku|ku)|my rank)[?.!]*$/iu],
    ['rank', /^(?:(?:tolong|coba|please)\s+)?(?:berapa rank(?: saya| aku|ku)|rank(?: saya| aku|ku) berapa|what(?:'s| is) my rank)[?.!]*$/iu],
    ['leaderboard', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|tampilkan|show|cek)\s+(?:leaderboard|papan peringkat|peringkat server)[?.!]*$/iu],
    ['nowplaying', /^(?:(?:tolong|coba|please)\s+)?(?:lagu apa yang (?:sedang )?(?:diputar|main)|apa yang sedang diputar|what(?:'s| is) playing|show now playing)[?.!]*$/iu],
    ['nowplaying', /^(?:(?:tolong|coba|please)\s+)?apa lagu yang sedang diputar[?.!]*$/iu],
    ['birthday info', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|cek|tampilkan|show|check)\s+(?:ulang tahun saya|ulang tahunku|my birthday)[?.!]*$/iu],
    ['birthday list', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|tampilkan|show)\s+(?:daftar ulang tahun|birthday list)[?.!]*$/iu],
    ['birthday next', /^(?:(?:tolong|coba|please)\s+)?siapa yang ulang tahun berikutnya[?.!]*$/iu],
    ['birthday next', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|tampilkan|show)\s+(?:ulang tahun berikutnya|upcoming birthdays)[?.!]*$/iu],
];
/** Only explicit Discord mentions can target another member; names and raw IDs are ambiguous. */
export function detectMemberIntent(text, { enabled = false, botId = null } = {}) {
    if (!enabled || typeof text !== 'string' || text.length > 800 || /[\r\n\u0000-\u001f\u007f]/u.test(text)) return null;
    if (botId !== null && !/^\d{17,20}$/.test(String(botId))) return null;
    let value = text;
    if (botId) value = value.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ');
    value = value.replace(/\s+/gu, ' ').trim();
    const patterns = [
        ['rank', /^(?:(?:tolong|coba|please|bisa tolong)\s+)?(?:cek rank|lihat rank|berapa rank|cek level|berapa level|show rank for)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['birthday info', /^(?:(?:tolong|coba|please|bisa tolong)\s+)?(?:cek ulang tahun|lihat ulang tahun|kapan ulang tahun|show birthday for)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['userinfo', /^(?:(?:tolong|coba|please|bisa tolong)\s+)?(?:cek info anggota|lihat info anggota|lihat profil anggota|show user info for)\s+<@!?(\d{17,20})>[?.!]*$/iu],
    ];
    for (const [command, pattern] of patterns) {
        const match = pattern.exec(value);
        if (match && match[1] !== botId) return { action:'command', command, args:[match[1]] };
    }
    return null;
}

// Targeted moderation/report requests are guidance only. The target is used solely
// to validate the Discord mention, never echoed, forwarded, or passed to a command.
export function detectTargetHandoff(text, { enabled = false, botId = null } = {}) {
    if (!enabled || typeof text !== 'string' || text.length > 800 || /[\r\n\u0000-\u001f\u007f]/u.test(text)) return null;
    if (botId !== null && !/^\d{17,20}$/.test(String(botId))) return null;
    let value = text;
    if (botId) value = value.replace(new RegExp(`<@!?${botId}>`, 'g'), ' ');
    value = value.replace(/\s+/gu, ' ').trim();
    const patterns = [
        ['ban', /^(?:(?:tolong|coba|please)\s+)?(?:ban)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['kick', /^(?:(?:tolong|coba|please)\s+)?(?:kick)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['timeout', /^(?:(?:tolong|coba|please)\s+)?(?:timeout)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['warn', /^(?:(?:tolong|coba|please)\s+)?(?:warn|peringatkan)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['warnings', /^(?:(?:tolong|coba|please)\s+)?(?:cek peringatan|lihat peringatan|view warnings for)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['report file', /^(?:(?:tolong|coba|please)\s+)?(?:laporkan|report)\s+<@!?(\d{17,20})>[?.!]*$/iu],
        ['dm', /^(?:(?:tolong|coba|please)\s+)?(?:kirim dm ke|send a dm to)\s+<@!?(\d{17,20})>[?.!]*$/iu],
    ];
    for (const [command, pattern] of patterns) {
        const match = pattern.exec(value);
        if (match && match[1] !== botId) return { action:'slash-handoff', command, targetId:match[1] };
    }
    return null;
}

export function detectNaturalIntent(text, { enabled = false } = {}) {
    if (!enabled || typeof text !== 'string' || text.length > 4000) return null;
    if (/[\r\n\u0000-\u001f\u007f]/u.test(text)) return null;
    const original = text.replace(/\s+/gu, ' ').trim();
    if (TRANSLATE.test(original)) return { action: 'translate-handoff' };
    // Only strip explicitly polite wrappers. Never infer an action from arbitrary prose.
    const value = original.replace(/^(?:bisa tolong|boleh tolong|mohon|boleh|bisa|please)\s+/iu, '');
    const exactValue = value.replace(/\s+(?:dong|ya|please)(?=[?.!]*$)/iu, '');
    for (const [command, pattern] of HANDOFFS) if (pattern.test(exactValue)) return { action: 'slash-handoff', command };
    // These workflows must collect their inputs and consent in a real slash interaction.
    // Recognize an accompanying topic only to offer guidance; never echo or forward it.
    const handoffWithTopic = [
        ['play', /^(?:(?:tolong|coba|please)\s+)?(?:putar lagu|mainkan lagu|play song)\s+(.+?)[?.!]*$/iu],
        ['play-mood', /^(?:(?:tolong|coba|please)\s+)?(?:putar musik sesuai suasana|mainkan musik sesuai suasana|play music by mood)\s+(.+?)[?.!]*$/iu],
        ['gambar', /^(?:(?:tolong|coba|please)\s+)?(?:buat gambar ai|generate an ai image of|create an ai image of)\s+(.+?)[?.!]*$/iu],
        ['drafbug', /^(?:(?:tolong|coba|please)\s+)?(?:buat draf laporan bug|buat draft laporan bug)\s+(.+?)[?.!]*$/iu],
    ];
    for (const [command, pattern] of handoffWithTopic) {
        const match = pattern.exec(value);
        if (match && validHandoffTopic(match[1])) return { action: 'slash-handoff', command };
    }
    for (const [command, pattern] of COMMANDS) if (pattern.test(exactValue)) return { action: 'command', command };
    // Only bounded, unambiguous data values are passed to audited single-argument commands.
    const patterns = [
        ['queue', /^(?:(?:tolong|coba|please)\s+)?(?:lihat|tampilkan|show)\s+(?:antrean lagu|antrian lagu|music queue|the queue)\s+(?:halaman|page)\s+(.+?)[?.!]*$/iu],
        ['time', /^(?:(?:tolong|coba|please)\s+)?(?:jam di|jam berapa di|waktu di|time in|what time is it in)\s+(.+?)[?.!]*$/iu],
        ['weather', /^(?:(?:tolong|coba|please)\s+)?(?:cuaca di|cuaca)\s+(.+?)\s+(?:gimana|bagaimana)[?.!]*$/iu],
        ['weather', /^(?:(?:tolong|coba|please)\s+)?(?:cuaca di|cuaca|cek cuaca di|cek cuaca|bagaimana cuaca di|gimana cuaca di|bagaimana cuaca|gimana cuaca|berapa suhu di|suhu di|weather in|what(?:'s| is) the weather in|what is the temperature in)\s+(.+?)[?.!]*$/iu],
        ['define', /^(?:(?:tolong|coba|please)\s+)?(?:arti kata|apa arti kata|cari definisi kata|define)\s+(.+?)[?.!]*$/iu],
        ['urban', /^(?:(?:tolong|coba|please)\s+)?(?:cari urban dictionary|urban dictionary)\s+(.+?)[?.!]*$/iu],
        ['search', /^(?:(?:tolong|coba|please)\s+)?(?:buat link google untuk|make google link for)\s+(.+?)[?.!]*$/iu],
    ];
    for (const [command, pattern] of patterns) {
        const match = pattern.exec(value);
        if (!match) continue;
        // /weather returns current conditions, not a forecast; strip only unambiguous current-time words.
        let arg = match[1];
        if (command === 'weather' || command === 'time') arg = arg.replace(/\s+(?:sekarang|saat ini|right now|currently)$/iu, '');
        if (command === 'time') {
            // Map only Indonesia's unambiguous fixed regional abbreviations; other
            // abbreviations still require an IANA zone so we do not guess.
            const zoneAliases = { WIB:'Asia/Jakarta', WITA:'Asia/Makassar', WIT:'Asia/Jayapura' };
            arg = zoneAliases[arg.toUpperCase()] ?? arg;
        }
        if (validArgument(command, arg)) return { action: 'command', command, args: [arg] };
    }
    return null;
}
function validHandoffTopic(value) {
    return value.length >= 1 && value.length <= 200 && !/[\r\n\u0000-\u001f\u007f]/u.test(value)
        && !/\b(?:dan|lalu|terus|kemudian|and then|then)\b/iu.test(value);
}
function validArgument(command, value) {
    if (typeof value !== 'string' || value !== value.trim()) return false;
    if (command === 'queue') return /^[1-9][0-9]{0,3}$/.test(value) && Number(value) <= 1000;
    if (command === 'time') return value.length <= 64 && (/^UTC$/i.test(value) || /^[a-zA-Z_+-]+(?:\/[a-zA-Z0-9_+-]+){1,2}$/.test(value)) && Boolean(resolveTimeZone(value));
    if (command === 'define' || command === 'urban') return /^[a-zA-Z][a-zA-Z'-]{1,99}$/.test(value);
    if (command === 'weather') return value.length >= 2 && value.length <= 100 && /^[\p{L}][\p{L}.' -]*$/u.test(value) && !/\b(?:dan|lalu|terus|kemudian|atau|bukan|tidak|jangan|besok|hari ini|kemarin|lagi|gimana|bagaimana|hujan|cerah|berawan|panas|dingin|and|then|or|not|tomorrow|today|yesterday)\b/iu.test(value);
    if (command === 'search') return value.length >= 1 && value.length <= 200 && /^[\p{L}\p{N}][\p{L}\p{N} .,'-]*$/u.test(value) && !/\b(?:dan|lalu|terus|kemudian|and then|then)\b/iu.test(value);
    return false;
}
function commandArguments(name, args) {
    if (!Array.isArray(args)) return null;
    if (name === 'queue') return args.length === 0 ? [] : args.length === 1 && validArgument(name,args[0]) ? [...args] : null;
    if (name === 'rank' || name === 'userinfo') return args.length === 0 ? [] : args.length === 1 && /^\d{17,20}$/.test(args[0]) ? [...args] : null;
    if (name === 'birthday info') return args.length === 0 ? ['info'] : args.length === 1 && /^\d{17,20}$/.test(args[0]) ? ['info', args[0]] : null;
    if (name === 'time') return args.length === 0 ? [] : args.length === 1 && validArgument(name,args[0]) ? [...args] : null;
    if (['weather','define','search','urban'].includes(name)) return args.length === 1 && validArgument(name,args[0]) ? [...args] : null;
    if (name.startsWith('birthday ')) return args.length === 0 ? [name.slice('birthday '.length)] : null;
    return args.length === 0 ? [] : null;
}

export function validateIntentExclusions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.excludedCommands) || value.excludedCommands.length > 100 || value.excludedCommands.some(v => typeof v !== 'string' || !/^[a-z0-9_-]{1,32}(?: [a-z0-9_-]{1,32}){0,2}$/.test(v)) || new Set(value.excludedCommands).size !== value.excludedCommands.length) throw Object.assign(new Error('Daftar pengecualian command tidak valid.'), { status: 400 });
    return { excludedCommands: [...value.excludedCommands].sort() };
}
export function createIntentStore(client) {
    const key = id => `ai:intent:exclusions:${id}`;
    const pool = () => { const d = client.db; if (!d || d.getStatus?.().isDegraded || !d.isAvailable?.() || !d.db?.isAvailable?.() || !d.db.pool) throw Object.assign(new Error('Database persisten tidak tersedia.'), {status:503}); return d.db.pool; };
    return {
        async read(id) { const db=sqliteBackend(client); const value=db?db.get(key(id)):(await pool().query(`SELECT value FROM ${pgConfig.tables.cache_data} WHERE key=$1`,[key(id)])).rows[0]?.value; return value == null ? {excludedCommands:[]} : validateIntentExclusions(value); },
        async save(id, value) { const checked=validateIntentExclusions(value),db=sqliteBackend(client); if(db) db.set(key(id),checked); else await pool().query(`INSERT INTO ${pgConfig.tables.cache_data} (key,value,expires_at) VALUES ($1,$2::jsonb,NULL) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,expires_at=NULL`,[key(id),JSON.stringify(checked)]); return checked; },
    };
}

// Discord command overrides cannot be faithfully applied by a prefix interaction. Refuse direct
// execution whenever there are overrides for the application or this command; use the real slash
// interaction instead. Re-fetch on each attempt so a cached allow cannot outlive a new restriction.
export async function hasNoDiscordCommandOverrides({client, message, commandName}) {
    const manager=message.guild?.commands;
    const appId=client.application?.id;
    if (!/^\d{17,20}$/.test(String(appId || '')) || typeof manager?.fetch !== 'function' || typeof manager.permissions?.fetch !== 'function') return false;
    try {
        const commands=await manager.fetch();
        if (!commands || typeof commands.values !== 'function') return false;
        const matching=[...commands.values()].filter(c=>c?.name===commandName && c.type===1);
        if (matching.length!==1 || !/^\d{17,20}$/.test(String(matching[0].id || ''))) return false;
        // A stale local registry must not bypass stricter deployed Discord defaults.
        // Zero is special in Discord (disabled by default), not an unrestricted command.
        const remote = matching[0], local = client.commands?.get(commandName)?.data?.toJSON?.();
        if (!local || typeof remote.nsfw !== 'boolean' || remote.nsfw || !Object.hasOwn(remote, 'defaultMemberPermissions')) return false;
        const remoteBits = remote.defaultMemberPermissions === null ? null : remote.defaultMemberPermissions?.bitfield;
        const localRaw = local.default_member_permissions;
        if (remoteBits !== null && typeof remoteBits !== 'bigint') return false;
        if (localRaw != null && !/^\d+$/.test(String(localRaw))) return false;
        const localBits = localRaw == null ? null : BigInt(localRaw);
        if (remoteBits === 0n || localBits === 0n || remoteBits !== localBits) return false;
        const overrides=await manager.permissions.fetch();
        if (!overrides || typeof overrides.get !== 'function' || typeof overrides.has !== 'function') return false;
        for (const id of [appId,matching[0].id]) {
            if (!overrides.has(id)) continue;
            const entries=overrides.get(id);
            if (!Array.isArray(entries) || entries.length !== 0) return false;
        }
        return true;
    } catch { return false; }
}

// Uses the prefix adapter only for audited actions. The private time response must go to the requesting user's DM.
export async function executeNaturalCommand({client, message, name, args = [], exclusions, dependencies = {}}) {
    const baseName = typeof name === 'string' ? name.split(' ')[0] : '';
    if (!SAFE_INTENT_COMMANDS.includes(name) || !Array.isArray(exclusions) || exclusions.includes(name) || exclusions.includes(baseName)) return 'excluded';
    const commandArgs = commandArguments(name, args);
    if (!commandArgs) return 'unavailable';
    const command=client.commands?.get(baseName);
    if (!command || command.data?.name !== baseName) return 'unavailable';
    // /queue is slash-only; a separately audited read-only snapshot uses its shared service in DM, without buttons.
    if (name !== 'queue' && (!supportsPrefixExecution(command) || getPrefixRestriction(command, commandArgs, resolveSubcommandAlias).blocked)) return 'unavailable';
    if (isMaintenanceMode() && !isBotOwner(message.author.id)) return 'unavailable';
    if (name === 'uptime' && !isBotOwner(message.author.id)) return 'unavailable';
    if (!isCommandCategoryEnabled(command.category)) return 'unavailable';
    const permissions=message.channel.permissionsFor?.(message.member);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return 'unavailable';
    const config=await (dependencies.getGuildConfig || getGuildConfig)(client,message.guild.id);
    if (!isCommandEnabledInConfig(config,name,command.category)) return 'unavailable';
    if (!(await (dependencies.hasNoDiscordCommandOverrides || hasNoDiscordCommandOverrides)({client,message,commandName:baseName}))) return 'discord-overrides';
    // The queue snapshot bypasses slash execution, so it must independently enforce
    // the same default/restricted access. Never assume a future command has no gate.
    if (name === 'queue' && !isBotOwner(message.author.id)) {
        if (isRestrictedCommand(baseName) && !memberHasRestrictedAccess(message.member, message.author.id, config)) return 'unavailable';
        if (!isRestrictedCommand(baseName) && !memberMeetsCommandPermissions(message.member, getCommandDefaultPermissions(command.data), { guildConfig:config, commandCategory:command.category })) return 'unavailable';
    }
    if (PRIVATE_INTENT_COMMANDS.includes(name) && typeof message.author.send !== 'function') return 'private-unavailable';
    const memberTarget = args.length > 0 && ['rank','birthday info','userinfo'].includes(name);
    if (memberTarget) {
        // userinfo is restricted; do not even look up the target for unauthorized users.
        if (name === 'userinfo' && !memberHasRestrictedAccess(message.member, message.author.id, config)) return 'unavailable';
        // Revalidate against the original Discord message; never accept names or
        // a caller-supplied snowflake alone, and refresh membership before reading.
        const botId=client.user?.id;
        if (!/^\d{17,20}$/.test(String(botId || ''))) return 'unavailable';
        const parsed=detectMemberIntent(message.content, { enabled:true, botId });
        if (!parsed || parsed.command !== name || parsed.args[0] !== args[0]
            || message.attachments?.size || message.stickers?.size
            || !message.mentions?.users?.has?.(args[0])
            || !(message.mentions?.users?.has?.(botId) || message.mentions?.repliedUser?.id === botId)
            || typeof message.guild.members?.fetch !== 'function') return 'unavailable';
    }
    const cooldown=Number(botConfig.commands?.defaultCooldown)||0;
    const key=`${message.author.id}:${baseName}`;
    if (cooldown>0 && !isBotOwner(message.author.id)) {
        if (!client.cooldowns?.get || !client.cooldowns?.set) return 'unavailable';
        if ((client.cooldowns.get(key)||0)>Date.now()) return 'cooldown';
        client.cooldowns.set(key,Date.now()+cooldown*1000);
    }
    const protection=await (dependencies.enforceAbuseProtection || enforceAbuseProtection)({guildId:message.guild.id,user:message.author},command,baseName);
    if (!protection.allowed) return 'cooldown';
    if (memberTarget) {
        try {
            const target=await message.guild.members.fetch({user:args[0],force:true});
            const cached=message.guild.members.cache?.get?.(args[0]);
            if (!target || target.id !== args[0] || target.user?.id !== args[0] || cached?.user?.id !== args[0]) return 'unavailable';
        } catch { return 'unavailable'; }
    }
    if (name === 'queue') {
        try {
            let payload;
            try { const page=(dependencies.buildQueueReply || buildQueueReply)(client,message.guild.id,Number(commandArgs[0] || 1)-1); payload={components:[page.components[0]],flags:page.flags,allowedMentions:{parse:[],repliedUser:false}}; }
            catch { payload={content:'Antrean musik tidak tersedia. Gunakan `/queue` untuk memeriksa.',allowedMentions:{parse:[],repliedUser:false}}; }
            await message.author.send(payload);
            return 'private-delivered';
        } catch { return 'private-unavailable'; }
    }
    let sentPrivately = false;
    const destination = PRIVATE_INTENT_COMMANDS.includes(name) ? {send:async payload=>{const result=await message.author.send(payload);sentPrivately=true;return result;}} : null;
    await (dependencies.executePrefixCommand || executePrefixCommand)(command,message,commandArgs,client,null,config,{allowedMentions:{parse:[],repliedUser:false},destination});
    if (PRIVATE_INTENT_COMMANDS.includes(name)) return sentPrivately ? 'private-delivered' : 'private-unavailable';
    return 'executed';
}

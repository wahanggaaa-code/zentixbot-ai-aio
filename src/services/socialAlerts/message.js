// message.js — the Components V2 "social alert" message (build only, no Discord calls).
//
// Top text display (optional, carries the mention when the admin chose one), then one Container:
//   title as a markdown link → optional AI summary → media gallery (thumbnail) → separator →
//   link button → footer. Totals stay far below Discord's 40-component / 4000-character caps.

import {
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorSpacingSize,
} from 'discord.js';
import { v2Message } from '../../utils/componentsV2.js';
import { DEFAULT_ACCENT_COLOR } from './store.js';

const PLATFORM_LABEL = { youtube: 'YouTube', twitch: 'Twitch' };
export const EVENT_KINDS = ['video', 'live', 'shorts'];
const MAX_TITLE = 250;
const MAX_CREATOR = 100;
const MAX_SUMMARY = 380;

const text = (content) => new TextDisplayBuilder().setContent(String(content ?? '').substring(0, 4000));
const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const escapeLinkText = (value) => oneLine(value).replace(/([[\]()])/g, '\\$1');
const safeUrl = (value) => (typeof value === 'string' && /^https:\/\//i.test(value) ? value : null);

/** Mention behavior for one send. When no role (and not everyone) is configured, mentions are suppressed. */
export function allowedMentionsFor(mentionRoleId) {
    if (mentionRoleId === 'everyone') return { parse: ['everyone'], roles: [], users: [] };
    if (typeof mentionRoleId === 'string' && /^\d{17,20}$/.test(mentionRoleId)) return { parse: [], roles: [mentionRoleId], users: [] };
    return { parse: [], roles: [], users: [] };
}

const roleMention = (mentionRoleId) => (mentionRoleId === 'everyone' ? '@everyone' : typeof mentionRoleId === 'string' && /^\d{17,20}$/.test(mentionRoleId) ? `<@&${mentionRoleId}>` : '');

const DEFAULT_TOPBAR = {
    video: (creator) => `📢 **${creator}** mengunggah video baru`,
    shorts: (creator) => `📢 **${creator}** mengunggah Shorts baru`,
    live: (creator) => `🔴 **${creator}** sedang live`,
};

/** Fill the admin's custom message template. Unknown placeholders are left as written. */
export function fillCustomMessage(template, vars) {
    if (typeof template !== 'string' || !template.trim()) return null;
    return template
        .replace(/\{creator\}/gi, oneLine(vars.creator))
        .replace(/\{title\}/gi, oneLine(vars.title))
        .replace(/\{url\}/gi, vars.url ?? '')
        .replace(/\{platform\}/gi, vars.platform ?? '')
        .replace(/\{role\}/gi, vars.role ?? '');
}

/**
 * Build the ready-to-send payload for one alert event.
 * `event`: { kind, title, url, creator?, thumbnail?, viewerCount?, game? }
 * `aiSummary`: optional string (already produced, never fetched here).
 */
export function buildSocialAlertMessage({ alert, event, aiSummary = null } = {}) {
    if (!alert || !event || !EVENT_KINDS.includes(event.kind)) {
        throw new TypeError('buildSocialAlertMessage: alert dan event yang valid wajib ada');
    }
    const platform = PLATFORM_LABEL[alert.platform] ?? alert.platform;
    const creator = oneLine(event.creator ?? alert.label).substring(0, MAX_CREATOR) || 'Kreator';
    const url = safeUrl(event.url);
    if (!url) throw new TypeError('buildSocialAlertMessage: event.url harus https');
    const title = oneLine(event.title).substring(0, MAX_TITLE) || 'Tanpa judul';
    const kind = event.kind;

    // --- the line above the container (carries the mention when configured) ---
    const role = roleMention(alert.mentionRoleId);
    const filled = fillCustomMessage(alert.customMessage, { creator, title, url, platform, role });
    // A mention the admin selected always lands in the text (that is what makes it ping):
    // either the admin wrote {role} into the custom message, or we prepend it.
    const rawTopbar = filled ?? DEFAULT_TOPBAR[kind](creator);
    const topbar = role && !rawTopbar.includes(role) ? `${role} ${rawTopbar}` : rawTopbar;

    const components = [];
    components.push(text(topbar));

    // --- the container ---
    const accent = String(alert.accentColor ?? DEFAULT_ACCENT_COLOR);
    const container = new ContainerBuilder().setAccentColor(
        /^#[0-9a-f]{6}$/i.test(accent) ? Number.parseInt(accent.slice(1), 16) : 0x5865F2,
    );

    const meta = [platform, creator];
    if (kind === 'live') {
        const extras = [];
        if (event.game) extras.push(oneLine(event.game).substring(0, 80));
        if (Number.isSafeInteger(event.viewerCount)) extras.push(`${event.viewerCount} penonton`);
        meta.push(`🔴 LIVE${extras.length ? ` — ${extras.join(' • ')}` : ''}`);
    }
    container.addTextDisplayComponents(
        text(`### [${escapeLinkText(title)}](${url})\n${meta.join(' • ')}`),
    );

    const summary = typeof aiSummary === 'string' ? oneLine(aiSummary).substring(0, MAX_SUMMARY) : '';
    if (summary) {
        container.addTextDisplayComponents(text(`✨ **Ringkasan AI**\n${summary}`));
    }

    const thumbnail = safeUrl(event.thumbnail);
    if (thumbnail) {
        const gallery = new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(thumbnail));
        container.addMediaGalleryComponents(gallery);
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(kind === 'live' ? 'Tonton Live' : 'Tonton Sekarang'),
        ),
    );
    container.addTextDisplayComponents(text(`-# Zentix Social Alerts${summary ? ' • Ringkasan oleh Zentix AI' : ''}`));

    components.push(container);

    return {
        ...v2Message(components),
        allowedMentions: allowedMentionsFor(alert.mentionRoleId),
    };
}

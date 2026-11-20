// componentsV2.js — helpers for Discord Components v2 (messages with the IsComponentsV2 flag).
// The bot's house style for message components; the classic embed factories (utils/embeds.js)
// are fully migrated and removed. New message code must use these builders, not EmbedBuilder.
//
// A Components v2 message cannot mix with content/embeds/attachments: every block must be a
// text display, section, separator, media gallery, file, or action row. v2Message() applies the
// IsComponentsV2 flag for you; forgetting it makes Discord reject the message.
import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} from 'discord.js';
import { getColor } from '../config/bot.js';

const EMOJI_REGEX = /[\p{Extended_Pictographic}\uFE0F]/gu;

export function sanitizeV2Text(text = '') {
  if (typeof text !== 'string') {
    return text;
  }

  return text
    .replace(EMOJI_REGEX, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]\n/g, '\n')
    .replace(/\n[ \t]/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function v2Text(content) {
  return new TextDisplayBuilder().setContent(sanitizeV2Text(String(content ?? '')).substring(0, 4000));
}

// Text display without the emoji/space sanitizer, for intentional announcement lines
// (e.g. giveaway banners) whose emoji are part of the design.
export function v2TextRaw(content) {
  return new TextDisplayBuilder().setContent(String(content ?? '').substring(0, 4000));
}

export function v2Separator({ divider = true, spacing = 1 } = {}) {
  return new SeparatorBuilder().setDivider(Boolean(divider)).setSpacing(spacing === 2 ? 2 : 1);
}

const IMPORTANT_FOOTER_PATTERN = /\b(close|closes|closed|expire|expires|available in|page\s+\d+|dashboard closes|ticket id)\b/i;

export function isImportantFooter(footerText) {
  return Boolean(footerText) && IMPORTANT_FOOTER_PATTERN.test(String(footerText).toLowerCase());
}

export function resolveAccentColor(color) {
  try {
    const value = Number(getColor(color));
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  } catch {
    // Fall through to the default below.
  }
  return 0x99aab5;
}

export function v2Flags(...extraFlags) {
  return extraFlags.reduce((flags, extra) => (extra ? flags | extra : flags), MessageFlags.IsComponentsV2);
}

// Wrap components into a ready-to-send payload. Accepts a single builder or a list.
export function v2Message(components, { ephemeral = false } = {}) {
  const list = Array.isArray(components) ? components : [components];
  return { components: list, flags: v2Flags(ephemeral ? MessageFlags.Ephemeral : 0) };
}

export function createV2Container({
  title = '',
  description = '',
  color = 'primary',
  fields = [],
  author = null,
  footer = null,
  thumbnail = null,
  image = null,
  raw = false, // keep Extended_Pictographic (Fun/announcement visuals); texts still cap at 4000/256
} = {}) {
  const container = new ContainerBuilder();
  if (color !== null) container.setAccentColor(resolveAccentColor(color));
  const text = raw ? v2TextRaw : v2Text;

  const top = [];
  const cleanTitle = title ? (raw ? String(title) : sanitizeV2Text(title)).substring(0, 256) : '';
  if (cleanTitle) {
    top.push(text(`## ${cleanTitle}`));
  }
  const authorName = author ? (typeof author === 'string' ? author : author?.name) : '';
  if (authorName) {
    const cleanAuthor = (raw ? String(authorName) : sanitizeV2Text(authorName)).substring(0, 256);
    top.push(text(`-# ${cleanAuthor}`));
  }
  if (description) {
    // Text displays are capped at 4000 characters by Discord; stay below it.
    top.push(raw ? v2TextRaw(String(description).substring(0, 4000)) : v2Text(String(description).substring(0, 4000)));
  }

  if (thumbnail && top.length > 0) {
    const section = new SectionBuilder().addTextDisplayComponents(...top);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail));
    container.addSectionComponents(section);
  } else if (top.length > 0) {
    container.addTextDisplayComponents(...top);
  }

  if (image) {
    const url = String(image).trim();
    if (/^https?:\/\//i.test(url)) {
      try {
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)),
        );
      } catch {
        // Skip invalid image URLs instead of failing the whole message.
      }
    }
  }

  const fieldBlocks = (Array.isArray(fields) ? fields : [])
    .filter((field) => field && field.name && field.value)
    .slice(0, 25)
    .map((field) => text(
      `**${(raw ? String(field.name) : sanitizeV2Text(String(field.name))).substring(0, 256)}**\n${(raw ? String(field.value) : sanitizeV2Text(String(field.value))).substring(0, 1024)}`,
    ));
  if (fieldBlocks.length > 0) {
    container.addSeparatorComponents(v2Separator({ divider: true, spacing: 1 }));
    container.addTextDisplayComponents(...fieldBlocks);
  }

  const footerText = footer ? (typeof footer === 'string' ? footer : footer?.text) : '';
  const cleanFooter = footerText ? sanitizeV2Text(footerText) : '';
  // `footer.always` renders the footer unconditionally (parity with classic embeds);
  // otherwise only important footers render.
  const forceFooter = typeof footer === 'object' && footer !== null && footer.always === true;
  if (cleanFooter && (forceFooter || isImportantFooter(cleanFooter))) {
    container.addSeparatorComponents(v2Separator({ divider: true, spacing: 1 }));
    container.addTextDisplayComponents(v2Text(`-# ${cleanFooter}`));
  }

  return container;
}

const V2_NOTIFICATION_DEFAULT_TITLES = {
  success: 'Success',
  error: 'Error',
  info: 'Information',
  warning: 'Warning',
  primary: 'Notice',
};

const V2_RENDERABLE_PATTERN = /<@!?&?\d+>|<#\d+>|\b\d{17,19}\b/;

/** v2 counterpart of buildNotificationEmbed: title with a mention moves into the body. */
export function v2Notification(title, body = '', color = 'primary') {
  const defaultTitle = V2_NOTIFICATION_DEFAULT_TITLES[color] || V2_NOTIFICATION_DEFAULT_TITLES.primary;
  let titleText = String(title || '').trim();
  let bodyText = body ? String(body).trim() : '';

  if (titleText && V2_RENDERABLE_PATTERN.test(titleText)) {
    bodyText = bodyText ? `${titleText}\n\n${bodyText}` : titleText;
    titleText = defaultTitle;
  }

  return createV2Container({ title: titleText || defaultTitle, description: bodyText || undefined, color });
}

/** One or two arguments like successEmbed: one arg is the body text. */
export function v2Success(title, body) {
  return arguments.length === 1
    ? v2Notification('Success', title, 'success')
    : v2Notification(title || 'Success', body, 'success');
}

export function v2Info(title, body) {
  return arguments.length === 1
    ? v2Notification('Information', title, 'info')
    : v2Notification(title || 'Information', body, 'info');
}

export function v2Warning(title, body) {
  return arguments.length === 1
    ? v2Notification('Warning', title, 'warning')
    : v2Notification(title || 'Warning', body, 'warning');
}

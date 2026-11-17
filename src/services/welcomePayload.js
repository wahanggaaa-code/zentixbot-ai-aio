import { MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { getColor, botConfig } from '../config/bot.js';
import { formatWelcomeMessage } from '../utils/welcome.js';
import { logger } from '../utils/logger.js';
import { createV2Container, v2Message } from '../utils/componentsV2.js';

// Adds the configured image as a media gallery item. Config URLs are user input:
// anything that is not an http(s) URL is skipped instead of breaking the send.
function addContainerImage(container, image) {
  if (typeof image !== 'string') return;
  const url = image.trim();
  if (!/^https?:\/\//i.test(url)) return;
  try {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)),
    );
  } catch (error) {
    logger.warn('Welcome/goodbye image skipped (invalid URL):', error?.message || error);
  }
}

// Ping content is folded into the description: v2 messages cannot carry `content`,
// and mentions inside text displays still notify when allowedMentions says so.
// Shared by real join, legacy goodbye and dashboard test so the test matches the bot's behavior.
export function buildWelcomePayload({member, config, canEmbed = true, test = false}) {
  const {user, guild} = member;
  const data = {user, guild, member};
  const message = formatWelcomeMessage(config.welcomeMessage || config.welcomeEmbed?.description || botConfig.welcome?.defaultWelcomeMessage || 'Welcome {user} to {server}!', data);
  const ping = config.welcomePing ? user.toString() : null;
  const allowedMentions = {parse: [], users: !test && config.welcomePing ? [user.id] : []};
  if (!canEmbed) return {content: ping ? `${ping} ${message}` : message, allowedMentions};
  const embedCfg = config.welcomeEmbed || {};
  const pingPrefix = ping && !message.includes(user.id) ? `${ping}\n` : '';
  const container = createV2Container({
    title: formatWelcomeMessage(embedCfg.title || '🎉 Welcome!', data),
    description: pingPrefix + message,
    color: embedCfg.color ?? getColor('success'),
    thumbnail: user.displayAvatarURL(),
    fields: [
      {name: 'User', value: `${user.tag} (${user.id})`},
      {name: 'Member Count', value: String(guild.memberCount)},
    ],
    footer: embedCfg.footer ? formatWelcomeMessage(embedCfg.footer, data) : `Welcome to ${guild.name}!`,
  });
  addContainerImage(container, config.welcomeImage || embedCfg.image?.url || (typeof embedCfg.image === 'string' ? embedCfg.image : undefined));
  return {...v2Message([container]), allowedMentions};
}

// Shared by the legacy goodbye path so welcome and goodbye look the same.
export function buildGoodbyePayload({member, config, test = false}) {
  const {user, guild} = member;
  const data = {user, guild, member};
  const message = formatWelcomeMessage(
    config?.leaveMessage || config?.leaveEmbed?.description || botConfig.welcome?.defaultGoodbyeMessage || '{user} has left the server.',
    data,
  );
  const embedCfg = config?.leaveEmbed || {};
  const ping = config?.goodbyePing ? user.toString() : null;
  const allowedMentions = !test && config?.goodbyePing ? {parse: [], users: [user.id]} : {parse: []};
  const pingPrefix = ping && !message.includes(user.id) ? `${ping}\n` : '';
  const container = createV2Container({
    title: formatWelcomeMessage(embedCfg.title || '👋 Goodbye', data),
    description: pingPrefix + message,
    color: embedCfg.color || getColor('error'),
    thumbnail: user.displayAvatarURL(),
    fields: [
      {name: 'User', value: `${user.tag} (${user.id})`},
      {name: 'Member Count', value: String(guild.memberCount)},
    ],
    footer: embedCfg.footer ? formatWelcomeMessage(embedCfg.footer, data) : `Goodbye from ${guild.name}!`,
  });
  addContainerImage(container, typeof embedCfg.image === 'string' ? embedCfg.image : embedCfg.image?.url);
  return {...v2Message([container]), allowedMentions};
}

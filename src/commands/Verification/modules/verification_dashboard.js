import { botConfig } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { createV2Container, v2Success, v2Message } from '../../../utils/componentsV2.js';
import { logger } from '../../../utils/logger.js';
import { ZentixBotError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';
import { saveVerificationDashboardChange } from '../../../services/config/verificationDashboardUpdate.js';
import { getWelcomeConfigForEditing } from '../../../utils/database.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';
import {
    getVerificationPanelStatus,
    formatPanelStatusField,
} from '../../../utils/panelStatus.js';
import { startDashboardSession, wrapDashboardHandler } from '../../../utils/dashboardSession.js';

const dashboardPayload = (container, components, { ephemeral = false } = {}) => ({ ...v2Message([container, ...components], { ephemeral }), allowedMentions: { parse: [] } });
const panelContainer = (cfg) => createV2Container({
    title: 'Server Verification',
    description: cfg.message || botConfig.verification.defaultMessage,
    color: 'success',
    raw: true,
});

async function updateLivePanel(guild, cfg) {
    if (!cfg.channelId || !cfg.messageId) return;
    try {
        const channel = guild.channels.cache.get(cfg.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
        if (!msg) return;

        const verifyContainer = panelContainer(cfg);

        const verifyButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_user')
                .setLabel(cfg.buttonText || botConfig.verification.defaultButtonText)
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
        );

        await msg.edit(dashboardPayload(verifyContainer, [verifyButton]));
    } catch (error) {
        logger.warn('Could not update live verification panel:', error.message);
    }
}

function buildDashboardContainer(cfg, guild, verifiedUserCount = 0, conflictSummary = '', panelStatus = null) {
    const channel = cfg.channelId ? `<#${cfg.channelId}>` : '`Not set`';
    const role = cfg.roleId ? `<@&${cfg.roleId}>` : '`Not set`';
    const rawMsg = cfg.message || botConfig.verification.defaultMessage;
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;
    const buttonText = cfg.buttonText || botConfig.verification.defaultButtonText;
    const panelStatusValue = cfg.channelId ? formatPanelStatusField(panelStatus) : '`Not configured`';

    const fields = [
        { name: 'Panel Status', value: panelStatusValue },
        { name: 'Verification Channel', value: channel },
        { name: 'Verified Role', value: role },
        { name: 'System Status', value: cfg.enabled !== false ? 'Enabled' : 'Disabled' },
        { name: 'Button Text', value: `\`${buttonText}\`` },
        { name: 'Verified Users', value: `${verifiedUserCount} users` },
        { name: 'Verification Message', value: msgPreview },
    ];

    if (conflictSummary) {
        fields.push({ name: 'Setup Conflicts', value: conflictSummary });
    }

    return createV2Container({
        title: '✅ Verification System Dashboard',
        description: `Manage verification settings for **${guild.name}**.\nSelect an option below to modify a setting.`,
        color: 'info',
        raw: true,
        fields,
        footer: 'Dashboard closes after 10 minutes of inactivity',
    });
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`verif_cfg_${guildId}`)
        .setPlaceholder('Select a setting to configure...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Verification Channel')
                .setDescription('Set the channel where the verification panel is posted')
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Change Verified Role')
                .setDescription('Set the role assigned when a user verifies')
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Edit Verification Message')
                .setDescription('Customise the message shown on the verification panel embed')
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Edit Button Text')
                .setDescription('Change the label on the verify button')
                .setValue('button_text')
                .setEmoji('🔘'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false, panelStatus = null) {
    const systemOn = cfg.enabled !== false;
    const showRepost =
        systemOn && panelStatus?.exists === false && panelStatus?.reason === 'panel_deleted';

    const buttons = [];

    if (showRepost) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`verif_cfg_repost_${guildId}`)
                .setLabel('Repost Panel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📌')
                .setDisabled(disabled),
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`verif_cfg_toggle_${guildId}`)
            .setLabel('Verification')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🔒')
            .setDisabled(disabled),
    );

    return new ActionRowBuilder().addComponents(buttons);
}

async function repostVerificationPanel(guild, cfg) {
    const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel) {
        throw new ZentixBotError(
            'Panel channel missing',
            ErrorTypes.CONFIGURATION,
            'The configured verification channel no longer exists. Set a new channel from the dashboard.',
        );
    }

    const verifyContainer = panelContainer(cfg);

    const verifyButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verify_user')
            .setLabel(cfg.buttonText || botConfig.verification.defaultButtonText)
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
    );

    return channel.send(dashboardPayload(verifyContainer, [verifyButton]));
}

async function refreshDashboard(rootInteraction, cfg, guildId, client) {
    try {
        const selectMenu = buildSelectMenu(guildId);

        let verifiedUserCount = 0;
        let conflictSummary = '';
        let panelStatus = null;

        if (cfg.channelId && cfg.enabled !== false) {
            const expected = structuredClone(cfg);
            panelStatus = await getVerificationPanelStatus(client, rootInteraction.guild, expected);
            if (panelStatus.recoveredId) {
                await saveVerificationDashboardChange(client, guildId, cfg, expected, { messageId: panelStatus.recoveredId });
            }
        }
        
        try {
            const verifiedRole = rootInteraction.guild.roles.cache.get(cfg.roleId);
            if (verifiedRole) {
                verifiedUserCount = verifiedRole.members.size;
            }
            
            const guildConfig = await getGuildConfig(client, guildId);
            const welcomeConfig = await getWelcomeConfigForEditing(client, guildId);
            const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
            const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                autoVerifyEnabled ? 'AutoVerify is enabled' : null,
                autoRoleConfigured ? 'AutoRole is configured' : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch verification dashboard details:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            ...dashboardPayload(
                buildDashboardContainer(cfg, rootInteraction.guild, verifiedUserCount, conflictSummary, panelStatus),
                [
                    buildButtonRow(cfg, guildId, false, panelStatus),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                { ephemeral: true },
            ),
        });
    } catch (error) {
        logger.debug('Could not refresh verification dashboard (interaction may have expired):', error.message);
    }
}

export default {
    prefixOnly: false,
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);
            const cfg = guildConfig.verification;

            if (!cfg?.channelId) {
                throw new ZentixBotError(
                    'Verification not configured',
                    ErrorTypes.CONFIGURATION,
                    'The verification system has not been set up yet. Run `/verification setup` first.',
                );
            }

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            let verifiedUserCount = 0;
            let conflictSummary = '';
            let panelStatus = null;

            if (cfg.channelId && cfg.enabled !== false) {
                const expected = structuredClone(cfg);
                panelStatus = await getVerificationPanelStatus(client, interaction.guild, expected);
                if (panelStatus.recoveredId) {
                    await saveVerificationDashboardChange(client, guildId, cfg, expected, { messageId: panelStatus.recoveredId });
                }
            }
            
            try {
                const verifiedRole = interaction.guild.roles.cache.get(cfg.roleId);
                if (verifiedRole) {
                    verifiedUserCount = verifiedRole.members.size;
                }
                
                const welcomeConfig = await getWelcomeConfigForEditing(client, guildId);
                const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    autoVerifyEnabled ? 'AutoVerify is enabled' : null,
                    autoRoleConfigured ? 'AutoRole is configured' : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch verification dashboard details:', error.message);
            }

            await startDashboardSession({
                interaction,
                container: buildDashboardContainer(cfg, interaction.guild, verifiedUserCount, conflictSummary, panelStatus),
                components: [
                    buildButtonRow(cfg, guildId, false, panelStatus),
                    new ActionRowBuilder().addComponents(buildSelectMenu(guildId)),
                ],
                flags: MessageFlags.Ephemeral,
                selectMenuId: `verif_cfg_${guildId}`,
                buttonMatcher: (customId) =>
                    customId === `verif_cfg_toggle_${guildId}` || customId === `verif_cfg_repost_${guildId}`,
                onSelect: async (selectInteraction) => {
                    const selectedOption = selectInteraction.values[0];
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role':
                            await handleRole(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'button_text':
                            await handleButtonText(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                },
                onButton: async (btnInteraction) => {
                    if (btnInteraction.customId === `verif_cfg_repost_${guildId}`) {
                        await btnInteraction.deferUpdate();
                        const expected = structuredClone(cfg);
                        const newMsg = await repostVerificationPanel(interaction.guild, expected);
                        await saveVerificationDashboardChange(client, guildId, cfg, expected, { messageId: newMsg.id });
                        await btnInteraction.followUp(v2Message([v2Success('Panel Reposted', `Verification panel restored in ${newMsg.channel}.`)], { ephemeral: true }));
                        await refreshDashboard(interaction, cfg, guildId, client);
                        return;
                    }

                    await btnInteraction.deferUpdate().catch(() => null);

                    const expected = structuredClone(cfg);
                    const next = structuredClone(expected);
                    const wasEnabled = expected.enabled !== false;
                    const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);

                    if (!wasEnabled && autoVerifyEnabled) {
                        await replyUserError(btnInteraction, {
                            type: ErrorTypes.CONFIGURATION,
                            message: 'AutoVerify is currently enabled. Please disable AutoVerify first before enabling the manual Verification system.\n\nRun `/autoverify` to access the AutoVerify dashboard.',
                        });
                        return;
                    }

                    next.enabled = !wasEnabled;

                    if (!next.enabled) next.messageId = null;

                    if (next.enabled && next.channelId) {
                        try {
                            const newMsg = await repostVerificationPanel(interaction.guild, next);
                            next.messageId = newMsg.id;
                        } catch (error) {
                            logger.warn('Could not re-post verification panel on re-enable:', error.message);
                            throw new ZentixBotError('Verification panel send failed', ErrorTypes.CONFIGURATION,
                                'Could not post the verification panel. Check Discord and reload the dashboard before retrying.');
                        }
                    }

                    await saveVerificationDashboardChange(client, guildId, cfg, expected, next);
                    // Do not delete the existing panel if the database write failed.
                    if (!next.enabled && expected.channelId && expected.messageId) {
                        const channel = interaction.guild.channels.cache.get(expected.channelId);
                        const msg = await channel?.messages.fetch(expected.messageId).catch(() => null);
                        if (msg) await msg.delete().catch(() => {});
                    }

                    await btnInteraction.followUp(v2Message([v2Success(
                        '✅ System Updated',
                        `The verification system is now **${cfg.enabled ? 'enabled' : 'disabled'}**.`,
                    )], { ephemeral: true }));

                    await refreshDashboard(interaction, cfg, guildId, client);
                },
                onTimeout: async (rootInteraction) => {
                    await InteractionHelper.safeEditReply(rootInteraction,
                        v2Message([createV2Container({
                            title: 'Dashboard Timed Out',
                            description: 'This dashboard has been closed due to inactivity. Please run the command again to continue.',
                            color: 'error',
                        })], { ephemeral: true }));
                },
            });
        } catch (error) {
            if (error instanceof ZentixBotError) throw error;
            logger.error('Unexpected error in verification_dashboard:', error);
            throw new ZentixBotError(
                `Verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the verification dashboard.',
            );
        }
    },
};

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    const expected = structuredClone(cfg);
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('verif_cfg_channel')
        .setPlaceholder('Select a text channel...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        ...dashboardPayload(
            createV2Container({
                title: 'Change Verification Channel',
                description: `**Current:** ${cfg.channelId ?`<#${cfg.channelId}>`: '`Not set`'}\n\nSelect the channel where the verification panel will be posted.\n\n> The existing panel will be deleted and re-posted in the new channel.`,
                color: 'info',
            }),
            [new ActionRowBuilder().addComponents(channelSelect)],
            { ephemeral: true },
        ),
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'verif_cfg_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', wrapDashboardHandler(async chanInteraction => {
        await chanInteraction.deferUpdate();
        const newChannel = chanInteraction.channels.first();

        if (!botHasPermission(newChannel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await replyUserError(chanInteraction, {
                type: ErrorTypes.PERMISSION,
                message: `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${newChannel}.`,
            });
            return;
        }

        const next = structuredClone(expected);
        next.messageId = null;

        if (expected.enabled !== false) {
            try {
                const verifyButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_user')
                        .setLabel(expected.buttonText || botConfig.verification.defaultButtonText)
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                );

                const newMsg = await newChannel.send(dashboardPayload(panelContainer(expected), [verifyButton]));
                next.messageId = newMsg.id;
            } catch (error) {
                logger.warn('Could not post verification panel in new channel:', error.message);
                throw new ZentixBotError('Verification panel send failed', ErrorTypes.CONFIGURATION,
                    'Could not post the verification panel. Check Discord and reload the dashboard before retrying.');
            }
        }

        next.channelId = newChannel.id;
        await saveVerificationDashboardChange(client, guildId, cfg, expected, next);
        // Only remove the old panel after the new configuration is committed.
        if (expected.channelId && expected.messageId) {
            const oldChannel = rootInteraction.guild.channels.cache.get(expected.channelId);
            const oldMsg = await oldChannel?.messages.fetch(expected.messageId).catch(() => null);
            if (oldMsg) await oldMsg.delete().catch(() => {});
        }

        await chanInteraction.followUp({ ...v2Message([v2Success('Channel Updated', `Verification panel moved to ${newChannel}.`)], { ephemeral: true }), allowedMentions: { parse: [] } });

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    }, 'nested dashboard selection'));

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'No channel was selected. The setting was not changed.',
            }).catch(() => {});
        }
    });
}

async function handleRole(selectInteraction, rootInteraction, cfg, guildId, client) {
    const expected = structuredClone(cfg);
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('verif_cfg_role')
        .setPlaceholder('Select a role...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        ...dashboardPayload(
            createV2Container({
                title: 'Change Verified Role',
                description: `**Current:** ${cfg.roleId ?`<@&${cfg.roleId}>`: '`Not set`'}\n\nSelect the role to assign when a user verifies.`,
                color: 'info',
            }),
            [new ActionRowBuilder().addComponents(roleSelect)],
            { ephemeral: true },
        ),
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'verif_cfg_role',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', wrapDashboardHandler(async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();
        const guild = rootInteraction.guild;
        const botMember = guild.members.me;

        if (role.id === guild.id || role.managed) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.VALIDATION,
                message: 'Please choose a normal assignable role (not @everyone or a bot-managed role).',
            });
            return;
        }

        if (role.position >= botMember.roles.highest.position) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                message: 'The verified role must be below my highest role in the server role hierarchy.',
            });
            return;
        }

        await saveVerificationDashboardChange(client, guildId, cfg, expected, { roleId: role.id });

        await roleInteraction.followUp({ ...v2Message([v2Success('Role Updated', `Verified role set to ${role}.`)], { ephemeral: true }), allowedMentions: { parse: [] } });

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    }, 'nested dashboard selection'));

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            replyUserError(selectInteraction, {
                type: ErrorTypes.RATE_LIMIT,
                message: 'No role was selected. The setting was not changed.',
            }).catch(() => {});
        }
    });
}

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const expected = structuredClone(cfg);
    let submitted;
    try {
        const modal = new ModalBuilder()
            .setCustomId('verif_cfg_message')
            .setTitle('Edit Verification Message')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('message_input')
                        .setLabel('Message shown on the verification panel embed')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(cfg.message || botConfig.verification.defaultMessage)
                        .setMaxLength(2000)
                        .setMinLength(1)
                        .setRequired(true),
                ),
            );

        await selectInteraction.showModal(modal);

        submitted = await selectInteraction
            .awaitModalSubmit({
                filter: i =>
                    i.customId === 'verif_cfg_message' && i.user.id === selectInteraction.user.id,
                time: 120_000,
            })
            .catch(() => null);

        if (!submitted) return;

        await saveVerificationDashboardChange(client, guildId, cfg, expected, { message: submitted.fields.getTextInputValue('message_input').trim() });

        await updateLivePanel(rootInteraction.guild, cfg);

        await submitted.reply(v2Message([v2Success('Message Updated', 'The verification panel has been updated with the new message.')], { ephemeral: true }));

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    } catch (error) {
        logger.error('Error in handleMessage:', error);
        await replyUserError(submitted || selectInteraction, {
            type: ErrorTypes.CONFIGURATION,
            message: error instanceof ZentixBotError ? error.userMessage : 'Failed to update configuration. Please reload the dashboard.',
        }).catch(() => {});
    }
}

async function handleButtonText(selectInteraction, rootInteraction, cfg, guildId, client) {
    const expected = structuredClone(cfg);
    let submitted;
    try {
        const modal = new ModalBuilder()
            .setCustomId('verif_cfg_button_text')
            .setTitle('Edit Button Text')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('button_text_input')
                        .setLabel('Button label (max 80 characters)')
                        .setStyle(TextInputStyle.Short)
                        .setValue(cfg.buttonText || botConfig.verification.defaultButtonText)
                        .setMaxLength(80)
                        .setMinLength(1)
                        .setRequired(true),
                ),
            );

        await selectInteraction.showModal(modal);

        submitted = await selectInteraction
            .awaitModalSubmit({
                filter: i =>
                    i.customId === 'verif_cfg_button_text' && i.user.id === selectInteraction.user.id,
                time: 120_000,
            })
            .catch(() => null);

        if (!submitted) return;

        await saveVerificationDashboardChange(client, guildId, cfg, expected, { buttonText: submitted.fields.getTextInputValue('button_text_input').trim() });

        await updateLivePanel(rootInteraction.guild, cfg);

        await submitted.reply(v2Message([v2Success('Button Text Updated', `The verify button now reads **${cfg.buttonText}**.`)], { ephemeral: true }));

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    } catch (error) {
        logger.error('Error in handleButtonText:', error);
        await replyUserError(submitted || selectInteraction, {
            type: ErrorTypes.CONFIGURATION,
            message: error instanceof ZentixBotError ? error.userMessage : 'Failed to update configuration. Please reload the dashboard.',
        }).catch(() => {});
    }
}

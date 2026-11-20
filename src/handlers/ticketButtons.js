import {randomUUID} from 'node:crypto';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } from 'discord.js';
import { createV2Container, v2Message } from '../utils/componentsV2.js';
import { createTicket, closeTicket, claimTicket, updateTicketPriority, getTicketLimit, countOpenTickets } from '../services/ticket.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { logTicketEvent } from '../utils/ticket/ticketLogging.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { replyUserError, ErrorTypes, handleInteractionError, createError } from '../utils/errorHandler.js';
import { getTicketPermissionContext } from '../utils/ticket/ticketPermissions.js';
import {ticketTypesFromConfig, ticketTypesRevision} from '../utils/ticket/ticketTypes.js';

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function ensureGuildContext(interaction) {
  if (interaction.inGuild()) {
    return true;
  }

  if (!interaction.replied && !interaction.deferred) {
    await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'This action can only be used in a server.' });
  }

  return false;
}

async function assertTicketPermission(interaction, client, actionLabel, options = {}, timeoutMs = 2500) {
  const { allowTicketCreator = false } = options;

  let context;
  try {
    const contextPromise = getTicketPermissionContext({ client, interaction });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    );
    context = await Promise.race([contextPromise, timeoutPromise]);
  } catch (error) {
    if (error.message === 'Timeout') {
      throw createError(
        'Ticket permission timeout',
        ErrorTypes.RATE_LIMIT,
        'The permission check took too long. Please try again.'
      );
    }
    throw createError(
      'Ticket permission check failed',
      ErrorTypes.UNKNOWN,
      `Failed to check permissions: ${error.message}`
    );
  }

  if (!context.ticketData) {
    throw createError(
      'Not a ticket channel',
      ErrorTypes.VALIDATION,
      'This action can only be used in a valid ticket channel.'
    );
  }

  const allowed = allowTicketCreator ? context.canCloseTicket : context.canManageTicket;
  if (!allowed) {
    const permissionMessage = allowTicketCreator
      ? 'You must have **Manage Channels**, the configured **Ticket Staff Role**, or be the **ticket creator**.'
      : 'You must have **Manage Channels** or the configured **Ticket Staff Role**.';
    throw createError(
      'Ticket permission denied',
      ErrorTypes.PERMISSION,
      `${permissionMessage}\n\nYou cannot ${actionLabel}.`
    );
  }

  return context;
}

async function ensureTicketPermission(interaction, client, actionLabel, options = {}) {
  const { allowTicketCreator = false } = options;

  const context = await getTicketPermissionContext({ client, interaction });

  if (!context.ticketData) {
    await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'This action can only be used in a valid ticket channel.' });
    return null;
  }

  const allowed = allowTicketCreator ? context.canCloseTicket : context.canManageTicket;
  if (!allowed) {
    const permissionMessage = allowTicketCreator
      ? 'You must have **Manage Channels**, the configured **Ticket Staff Role**, or be the **ticket creator**.'
      : 'You must have **Manage Channels** or the configured **Ticket Staff Role**.';

    await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: `${permissionMessage}\n\nYou cannot ${actionLabel}.` });
    return null;
  }

  return context;
}

const createTicketHandler = {
  name: 'create_ticket',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const rateLimitKey = `${interaction.user.id}:create_ticket`;
      const allowed = await checkRateLimit(rateLimitKey, 3, 60000);
      if (!allowed) {
        await replyUserError(interaction, { type: ErrorTypes.RATE_LIMIT, message: 'You are creating tickets too quickly. Please wait a minute and try again.' });
        return;
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const maxTicketsPerUser = getTicketLimit(config);
      const currentTicketCount = await countOpenTickets(interaction.guild, interaction.user.id, maxTicketsPerUser);
      
      if (currentTicketCount >= maxTicketsPerUser) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `You have reached the maximum number of open tickets (${maxTicketsPerUser}).\n\nPlease close your existing tickets before creating a new one.\n\n**Current Tickets:** ${currentTicketCount}/${maxTicketsPerUser}` });
      }
      
      const types = ticketTypesFromConfig(config);
      if (types.length) {
        const revision=ticketTypesRevision(types);
        const buttons=new ActionRowBuilder().addComponents(types.map(type=>new ButtonBuilder().setCustomId(`create_ticket_type:${type.id}:${revision}`).setLabel(type.name).setStyle(ButtonStyle.Secondary)));
        await interaction.reply({...v2Message([createV2Container({title:'Pilih jenis tiket',description:'Pilih jenis yang sesuai untuk membuka formulir.',color:'primary'}),buttons],{ephemeral:true})});
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('create_ticket_modal')
        .setTitle('Create a Ticket');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why are you creating this ticket?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe your issue...')
        .setRequired(true)
        .setMaxLength(1000);

      const actionRow = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error creating ticket modal:', error);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Could not open ticket creation form.' });
      }
    }
  }
};

const createTicketTypeHandler = {
  name:'create_ticket_type',
  async execute(interaction,client,args=[]) {
    try {
      if (!(await ensureGuildContext(interaction))) return;
      const types=ticketTypesFromConfig(await getGuildConfig(client,interaction.guildId));
      const type=types.find(x=>x.id===args[0]);
      if (!type || args[1]!==ticketTypesRevision(types)) {
        await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'Jenis tiket telah berubah. Tekan tombol buat tiket lagi.'});return;
      }
      const modal=new ModalBuilder().setCustomId(`create_ticket_modal:${type.id}:${args[1]}`).setTitle(`Tiket: ${type.name}`.slice(0,45));
      type.questions.forEach((question,i)=>modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`answer_${i}`).setLabel(question).setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true))));
      await interaction.showModal(modal);
    } catch(error) {await handleInteractionError(interaction,error,{type:'button',handler:'ticket',customId:interaction.customId});}
  }
};

const createTicketModalHandler = {
  name: 'create_ticket_modal',
  async execute(interaction, client, args = []) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;
      
      const config = await getGuildConfig(client, interaction.guildId);
      let reason, ticketType = null;
      if(args.length){
        const types=ticketTypesFromConfig(config), type=types.find(x=>x.id===args[0]);
        if(!type || args[1]!==ticketTypesRevision(types)){await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'Formulir berubah. Tekan tombol buat tiket lagi.'});return;}
        const answers=type.questions.map((question,i)=>({question,answer:interaction.fields.getTextInputValue(`answer_${i}`).trim()}));
        if(answers.some(x=>!x.answer||x.answer.length>500)){await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'Semua jawaban wajib diisi (maksimal 500 karakter).'});return;}
        ticketType={id:type.id,name:type.name,answers,...(type.categoryId?{categoryId:type.categoryId}:{})};
        reason=answers.map(x=>`${x.question}: ${x.answer}`).join('\n\n');
      }else reason=interaction.fields.getTextInputValue('reason');
      const categoryId = ticketType?.categoryId || config.ticketCategoryId || null;
      
      const { channel } = await createTicket(
        interaction.guild,
        interaction.member,
        categoryId,
        reason,
        'none',
        ticketType ? {ticketType} : {}
      );
      await interaction.editReply({
        ...v2Message([createV2Container({ title: 'Ticket Created', description: `Your ticket has been created in ${channel}!`, color: 'success' })])
      });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};

const closeTicketHandler = {
  name: 'ticket_close',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'close this ticket', { allowTicketCreator: true }, 2000);

      const modal = new ModalBuilder()
        .setCustomId('ticket_close_modal')
        .setTitle('Close Ticket');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for closing (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Add an optional reason for closing this ticket...')
        .setRequired(false)
        .setMaxLength(1000);

      const actionRow = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error closing ticket:', error);

      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Could not open ticket close form.' });
      }
    }
  }
};

const closeTicketModalHandler = {
  name: 'ticket_close_modal',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'close this ticket', { allowTicketCreator: true }, 2000);

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const providedReason = interaction.fields.getTextInputValue('reason')?.trim();
      const reason = providedReason || 'Closed via ticket button without a specific reason.';

      await closeTicket(interaction.channel, interaction.user, reason);
      await interaction.editReply({ ...v2Message([createV2Container({ title: 'Ticket Closed', description: 'This ticket has been closed.', color: 'success' })]) });
    } catch (error) {
      // Shows the reason given by the ticket service (already closed, already claimed, missing permission).
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};

const claimTicketHandler = {
  name: 'ticket_claim',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'claim tickets', {}, 2000);

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;
      
      await claimTicket(interaction.channel, interaction.user);
      await interaction.editReply({ ...v2Message([createV2Container({ title: 'Ticket Claimed', description: 'You have claimed this ticket.', color: 'success' })]) });
    } catch (error) {
      // Shows the reason given by the ticket service (already closed, already claimed, missing permission).
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};

// Shared by the card button and /transfer-ticket for tickets claimed before this update.
export async function showTicketTransferModal(interaction, client) {
  if (!(await ensureGuildContext(interaction))) return;
  const context=await assertTicketPermission(interaction,client,'transfer tickets',{},2000);
  const ticket=context.ticketData;
  if(ticket.status!=='open'||!/^\d{17,20}$/.test(ticket.claimedBy||'')) {
    await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'Tiket harus terbuka dan sudah diklaim untuk ditransfer.'});return;
  }
  if(ticket.claimedBy!==interaction.user.id&&!context.hasManageChannels){
    await replyUserError(interaction,{type:ErrorTypes.PERMISSION,message:'Hanya penanggung jawab saat ini atau anggota dengan Manage Channels yang dapat mentransfer tiket ini.'});return;
  }
  const input=new TextInputBuilder().setCustomId('staff_id').setLabel('ID Discord staff tujuan').setPlaceholder('Contoh: 123456789012345678').setStyle(TextInputStyle.Short).setMinLength(17).setMaxLength(20).setRequired(true);
  const modal=new ModalBuilder().setCustomId(`ticket_transfer_modal:${ticket.claimedBy}`).setTitle('Transfer penanggung jawab').addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}
const transferTicketHandler={
  name:'ticket_transfer',
  async execute(interaction,client){try{await showTicketTransferModal(interaction,client)}catch(error){await handleInteractionError(interaction,error,{type:'button',handler:'ticket',customId:interaction.customId})}}
};
const transferTicketModalHandler={
  name:'ticket_transfer_modal',
  async execute(interaction,client,args=[]){
    try{
      if(!(await ensureGuildContext(interaction)))return;
      const deferred=await InteractionHelper.safeDefer(interaction,{flags:MessageFlags.Ephemeral});if(!deferred)return;
      const context=await assertTicketPermission(interaction,client,'transfer tickets',{},2000),expected=args[0];
      if(!/^\d{17,20}$/.test(expected||'')||context.ticketData.status!=='open'||context.ticketData.claimedBy!==expected){await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'Tiket atau penanggung jawab berubah. Buka formulir transfer lagi.'});return;}
      if(expected!==interaction.user.id&&!context.hasManageChannels){await replyUserError(interaction,{type:ErrorTypes.PERMISSION,message:'Hanya penanggung jawab saat ini atau anggota dengan Manage Channels yang dapat mentransfer tiket ini.'});return;}
      const targetId=interaction.fields.getTextInputValue('staff_id').trim();
      if(!/^\d{17,20}$/.test(targetId)){await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'ID staff harus berupa ID Discord 17–20 digit.'});return;}
      const {transferTicket}=await import('../services/ticket.js');const result=await transferTicket(interaction.channel,interaction.user,targetId,expected);
      await interaction.editReply({...v2Message([createV2Container({title:'Transfer tersimpan',description:result.displayUpdated?`Tiket ditransfer ke <@${targetId}>.`:`Tiket ditransfer ke <@${targetId}>, tetapi tampilan Discord gagal diperbarui. Periksa tiket sebelum mencoba lagi.`,color:result.displayUpdated?'success':'warning'})]),allowedMentions:{parse:[]}});
    }catch(error){await handleInteractionError(interaction,error,{type:'modal',handler:'ticket',customId:interaction.customId})}
  }
};

const priorityTicketHandler = {
  name: 'ticket_priority',
  async execute(interaction, client, args) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'change ticket priority', {}, 2000);

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;
      
      const priority = args?.[0];
      if (!priority) {
        await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'A priority value is required.' });
        return;
      }

      await updateTicketPriority(interaction.channel, priority, interaction.user);
      await interaction.editReply({ ...v2Message([createV2Container({ title: 'Priority Updated', description: `Ticket priority set to **${priority.toUpperCase()}**.`, color: 'success' })]) });
    } catch (error) {
      // Shows the reason given by the ticket service (already closed, already claimed, missing permission).
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};

const pinTicketHandler = {
  name: 'ticket_pin',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'pin tickets', {}, 2000);

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const channel = interaction.channel;
      const category = channel.parent;

      if (!category) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'This ticket is not in a category.' });
        return;
      }

      const hasPingEmoji = channel.name.startsWith('📌');
      
      if (hasPingEmoji) {
        
        const newName = channel.name.replace(/^📌\s*/, '');
        await channel.edit({
          name: newName,
          position: 999 
        });

        await interaction.editReply({
          ...v2Message([createV2Container({ title: 'Ticket Unpinned',
            description: 'This ticket has been unpinned and moved back to normal position.',
            color: 0x95A5A6 })])
        });

        logger.info('Ticket unpinned', {
          guildId: interaction.guildId,
          channelId: channel.id,
          channelName: newName,
          userId: interaction.user.id
        });
      } else {
        
        const pinnedName = `📌 ${channel.name}`;
        await channel.edit({
          name: pinnedName,
          position: 0 
        });

        await interaction.editReply({
          ...v2Message([createV2Container({ title: 'Ticket Pinned',
            description: 'This ticket has been pinned to the top of the category.',
            color: 0x3498db })])
        });

        logger.info('Ticket pinned', {
          guildId: interaction.guildId,
          channelId: channel.id,
          channelName: pinnedName,
          userId: interaction.user.id
        });
      }

      await logTicketEvent({
        client: interaction.client,
        guildId: interaction.guildId,
        event: {
          type: hasPingEmoji ? 'unpin' : 'pin',
          ticketId: channel.id,
          ticketNumber: channel.name.replace(/[^0-9]/g, ''),
          userId: interaction.user.id,
          executorId: interaction.user.id,
          metadata: {
            isPinned: !hasPingEmoji,
            newChannelName: hasPingEmoji ? channel.name.replace(/^📌\s*/, '') : `📌 ${channel.name}`
          }
        }
      });

    } catch (error) {
      logger.error('Error pinning/unpinning ticket:', error);
      if (!interaction.replied && !interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to pin/unpin the ticket.' });
      } else if (interaction.deferred) {
        await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to pin/unpin the ticket.' });
      }
    }
  }
};

const unclaimTicketHandler = {
  name: 'ticket_unclaim',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'unclaim tickets', {}, 2000);

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;
      
      const { unclaimTicket } = await import('../services/ticket.js');
      await unclaimTicket(interaction.channel, interaction.member);
      await interaction.editReply({ ...v2Message([createV2Container({ title: 'Ticket Unclaimed', description: 'This ticket has been unclaimed.', color: 'success' })]) });
    } catch (error) {
      // Shows the reason given by the ticket service (already closed, already claimed, missing permission).
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};

const reopenTicketHandler = {
  name: 'ticket_reopen',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      await assertTicketPermission(interaction, client, 'reopen tickets', {}, 2000);

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;
      
      const { reopenTicket } = await import('../services/ticket.js');
      const { movedToOpenCategory, openCategoryMoveFailed } = await reopenTicket(interaction.channel, interaction.member);
      let reopenMessage = 'This ticket has been reopened.';
      if (openCategoryMoveFailed) {
        reopenMessage += ' Note: Could not move the channel back to the open tickets category.';
      }
      await interaction.editReply({ ...v2Message([createV2Container({ title: 'Ticket Reopened', description: reopenMessage, color: 'success' })]) });
    } catch (error) {
      // Shows the reason given by the ticket service (already closed, already claimed, missing permission).
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};

// Short-lived, user-bound confirmation. A fabricated or stale component cannot authorize deletion.
const deletionConfirmations=new Map();
const deleteTicketHandler = {
  name: 'ticket_delete',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;
      await assertTicketPermission(interaction, client, 'delete tickets', {}, 2000);
      const config=await getGuildConfig(client,interaction.guildId);
      if(!config.ticketTranscriptChannelId){
        const now=Date.now();for(const [key,entry] of deletionConfirmations)if(entry.expires<=now)deletionConfirmations.delete(key);
        if(deletionConfirmations.size>=500)deletionConfirmations.delete(deletionConfirmations.keys().next().value);
        const nonce=randomUUID();deletionConfirmations.set(nonce,{userId:interaction.user.id,guildId:interaction.guildId,channelId:interaction.channel.id,expires:now+120000});
        const warning=createV2Container({title:'Hapus tanpa transcript?',description:'Channel transcript belum diatur. Menghapus tiket akan menghilangkan percakapan tanpa arsip. Atur channel transcript, atau konfirmasi jika yakin.',color:'warning'});
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ticket_delete_no_transcript:${nonce}`).setLabel('Hapus tanpa transcript').setStyle(ButtonStyle.Danger));
        await interaction.reply({...v2Message([warning,row],{ephemeral:true})});return;
      }
      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;
      const { deleteTicket } = await import('../services/ticket.js');
      await deleteTicket(interaction.channel, interaction.member);
      await interaction.editReply({ ...v2Message([createV2Container({ title: 'Ticket Deleted', description: 'This ticket will be deleted shortly.', color: 'success' })]) });
    } catch (error) {
      await handleInteractionError(interaction, error, { type: 'button', handler: 'ticket', customId: interaction.customId });
    }
  }
};
const deleteWithoutTranscriptHandler={
 name:'ticket_delete_no_transcript',
 async execute(interaction,client,args=[]){
  try{
   if(!(await ensureGuildContext(interaction)))return;
   const nonce=args[0],entry=deletionConfirmations.get(nonce);
   if(!entry||entry.expires<=Date.now()||entry.userId!==interaction.user.id||entry.guildId!==interaction.guildId||entry.channelId!==interaction.channel.id){await replyUserError(interaction,{type:ErrorTypes.VALIDATION,message:'Konfirmasi tidak valid atau kedaluwarsa. Tekan Delete Ticket lagi.'});return}
   await assertTicketPermission(interaction,client,'delete tickets',{},2000);
   deletionConfirmations.delete(nonce);
   const deferSuccess=await InteractionHelper.safeDefer(interaction,{flags:MessageFlags.Ephemeral});if(!deferSuccess)return;
   const {deleteTicket}=await import('../services/ticket.js');await deleteTicket(interaction.channel,interaction.member,{allowNoTranscript:true});
   await interaction.editReply({...v2Message([createV2Container({title:'Penghapusan dijadwalkan',description:'Tiket akan dihapus. Tanpa channel transcript, percakapan tidak diarsipkan.',color:'warning'})])});
  }catch(error){await handleInteractionError(interaction,error,{type:'button',handler:'ticket',customId:interaction.customId})}
 }
};

export default createTicketHandler;
export { 
  createTicketModalHandler, 
  createTicketTypeHandler,
  transferTicketHandler,
  transferTicketModalHandler,
  closeTicketModalHandler,
  closeTicketHandler, 
  claimTicketHandler, 
  priorityTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
  deleteWithoutTranscriptHandler
};
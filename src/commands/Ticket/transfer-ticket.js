import {SlashCommandBuilder} from 'discord.js';
import {showTicketTransferModal} from '../../handlers/ticketButtons.js';

// Available even on ticket cards created before the Transfer button existed.
export default {
  data:new SlashCommandBuilder().setName('transfer-ticket').setDescription('Transfer a claimed ticket to another staff member.').setDMPermission(false),
  async execute(interaction,guildConfig,client){await showTicketTransferModal(interaction,client);},
};

import { SlashCommandBuilder } from 'discord.js';
import urban, { MAX_TERM_LENGTH } from './modules/search_urban.js';
export default {
    data: new SlashCommandBuilder().setName('urban').setDescription('Search Urban Dictionary (age-restricted channels only)')
        .addStringOption(option => option.setName('term').setDescription('The term to look up').setMinLength(2).setMaxLength(MAX_TERM_LENGTH).setRequired(true)),
    execute: urban.execute,
};

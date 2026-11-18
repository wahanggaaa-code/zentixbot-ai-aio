import { SlashCommandBuilder } from 'discord.js';
import google, { MAX_QUERY_LENGTH } from './modules/search_google.js';

export default {
    data: new SlashCommandBuilder().setName('search').setDescription('Create a Google search link')
        .addStringOption(option => option.setName('query').setDescription('What would you like to search for?').setMinLength(1).setMaxLength(MAX_QUERY_LENGTH).setRequired(true)),
    execute: google.execute,
};

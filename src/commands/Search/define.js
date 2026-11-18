import { SlashCommandBuilder } from 'discord.js';
import define, { MAX_WORD_LENGTH } from './modules/search_define.js';
export default {
    data: new SlashCommandBuilder().setName('define').setDescription('Look up an English word definition')
        .addStringOption(option => option.setName('word').setDescription('The word to look up').setMinLength(2).setMaxLength(MAX_WORD_LENGTH).setRequired(true)),
    execute: define.execute,
};

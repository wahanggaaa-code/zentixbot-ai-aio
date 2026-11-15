import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createKV } from '../../services/ai/kv.js';
import { LANGUAGES } from '../../services/ai/smartSettings.js';
import { createPersonalLanguageStore } from '../../services/ai/personalLanguage.js';

const FLAG = { id: '\u{1F1EE}\u{1F1E9}', en: '\u{1F1EC}\u{1F1E7}', ja: '\u{1F1EF}\u{1F1F5}', ko: '\u{1F1F0}\u{1F1F7}', zh: '\u{1F1E8}\u{1F1F3}', ar: '\u{1F1F8}\u{1F1E6}' };
const CHOICES = [
  ...Object.entries(LANGUAGES).map(([value, name]) => ({ name: `${FLAG[value]} ${name.replace(/^Bahasa /, '')}`, value })),
  { name: '\u{1F5D1}\uFE0F Reset: hapus bahasa pribadi', value: 'reset' },
];

export default {
    data: new SlashCommandBuilder()
        .setName('personal')
        .setDescription('Atur bahasa pribadimu untuk terjemahan (menu Terjemahkan).')
        .setDMPermission(false)
        .addStringOption((option) => option
            .setName('bahasa')
            .setDescription('Bahasa kamu; kosongkan untuk melihat pengaturan sekarang')
            .setRequired(false)
            .addChoices(...CHOICES)),

    async execute(interaction, guildConfig, client) {
        if (interaction.guildId !== client.homeGuildId) {
            return interaction.reply({ content: 'Command ini hanya tersedia di server utama bot.', flags: MessageFlags.Ephemeral });
        }
        const store = createPersonalLanguageStore(createKV(client));
        const choice = interaction.options.getString('bahasa');
        try {
            if (!choice) {
                const current = await store.get(interaction.guildId, interaction.user.id);
                const text = current
                    ? `Bahasa pribadimu: **${LANGUAGES[current]}**. Ganti dengan \`/personal bahasa:\`, atau hapus dengan pilihan Reset.`
                    : 'Bahasa pribadimu belum diatur; terjemahan memakai bahasa tujuan server. Atur dengan \`/personal bahasa:\`.';
                return interaction.reply({ content: text, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            }
            if (choice === 'reset') {
                await store.clear(interaction.guildId, interaction.user.id);
                return interaction.reply({ content: 'Bahasa pribadi dihapus. Menu Terjemahkan kembali memakai bahasa tujuan server.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            }
            await store.set(interaction.guildId, interaction.user.id, choice);
            return interaction.reply({ content: `Bahasa pribadimu sekarang **${LANGUAGES[choice]}**. Menu (tahan pesan → Apps → Terjemahkan) menerjemahkan ke bahasa ini.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        } catch {
            return interaction.reply({ content: 'Tidak dapat menyimpan pengaturan. Coba lagi nanti.', flags: MessageFlags.Ephemeral });
        }
    },
};

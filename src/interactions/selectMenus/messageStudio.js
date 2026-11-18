// Select menus created by Message Studio are bound to the exact stored bot message.
export default {
    name: 'ms_sel',
    async execute(interaction, client, args) {
        if (!client.messageStudio) return interaction.reply({ content: 'Message Studio belum tersedia.', ephemeral: true });
        return client.messageStudio.handleSelect(interaction, args);
    },
};

// Buttons created by Message Studio never execute arbitrary user-provided custom IDs.
// The stored document is looked up again by the service before an ephemeral response is shown.
export default {
    name: 'ms_btn',
    async execute(interaction, client, args) {
        if (!client.messageStudio) return interaction.reply({ content: 'Message Studio belum tersedia.', ephemeral: true });
        return client.messageStudio.handleButton(interaction, args);
    },
};

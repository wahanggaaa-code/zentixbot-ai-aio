// The nonce is resolved server-side and bound to the invoking guild and user.
export default {
    name: 'ms_form',
    async execute(interaction, client, args) {
        if (!client.messageStudio) return interaction.reply({ content: 'Message Studio belum tersedia.', ephemeral: true });
        return client.messageStudio.handleModal(interaction, args);
    },
};

import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { deleteBirthday } from '../../../services/birthdayService.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        const result = await deleteBirthday(client, guildId, userId);

        if (result.status === 'not_found') {
            const container = createV2Container({
                title: 'No Birthday Found',
                description: 'You don\'t have a birthday set to remove.',
                color: 'error',
            });
            await InteractionHelper.safeEditReply(interaction, v2Message([container]));
            return;
        }

        const container = createV2Container({
            title: 'Birthday Removed',
            description: 'Your birthday has been successfully removed from the server.',
            color: 'success',
        });
        await InteractionHelper.safeEditReply(interaction, v2Message([container]));
    }
};
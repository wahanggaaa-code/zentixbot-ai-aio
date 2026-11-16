import { handleSelfRoleButton } from '../../../handlers/interactionHandlers/selfRolesPanel.js';

export async function execute(interaction, client, args) {
    return handleSelfRoleButton(interaction, client, args);
}

export default {
    name: 'sr_btn',
    execute,
};

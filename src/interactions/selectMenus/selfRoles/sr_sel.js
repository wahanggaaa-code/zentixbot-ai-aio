import { handlePanelSelect } from '../../../handlers/interactionHandlers/selfRolesPanel.js';

export async function execute(interaction, client, args) {
    return handlePanelSelect(interaction, client, args?.[0]);
}

export default {
    name: 'sr_sel',
    execute,
};

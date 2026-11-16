// Legacy select menu (`reaction_roles`, no arguments): panels posted before the unified
// module. They are read from the same store now and honor the behavior mode they carry.
import { handlePanelSelect } from '../../../handlers/interactionHandlers/selfRolesPanel.js';

export async function execute(interaction, client) {
    return handlePanelSelect(interaction, client);
}

export default {
    name: 'reaction_roles',
    execute,
};

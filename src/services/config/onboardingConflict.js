import {createError, ErrorTypes} from '../../utils/errorHandler.js';

// Caller must hold the guild row lock before reading either record and writing.
// All cooperating writers must use that same lock order (guild, then welcome).
// Verification and auto-verify no longer exist: a welcome autorole never
// conflicts with anything, so only the shape of both records is checked.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function reject(message, userMessage) {
    const error = createError(message, ErrorTypes.CONFIGURATION, userMessage);
    error.status = 409;
    throw error;
}
export function assertOnboardingShape(guild, welcome) {
    if (!object(guild) || !object(welcome) ||
        (guild.ok !== undefined && guild.value !== undefined) ||
        (welcome.ok !== undefined && welcome.value !== undefined)) {
        reject('Invalid onboarding configuration', 'Server or welcome settings need review before editing.');
    }
    if (guild.autoRole !== undefined && guild.autoRole !== null && typeof guild.autoRole !== 'string') {
        reject('Invalid autorole configuration', 'Server autorole settings need review before editing.');
    }
    if (welcome.roleIds !== undefined && (!Array.isArray(welcome.roleIds) || welcome.roleIds.some(id => typeof id !== 'string' || !id))) {
        reject('Invalid welcome autorole configuration', 'Welcome autorole settings need review before editing.');
    }
}
export function assertOnboardingCompatible(guild, welcome) {
    assertOnboardingShape(guild, welcome);
}

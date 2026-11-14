/**
 * Where a member can reach the bot owner: the Discord profile of the first user ID in OWNER_IDS.
 *
 * A profile address does not expire, unlike an invite link, and nothing personal has to be written
 * into the code: a copy of this bot run by someone else points to that person's own account.
 *
 * @returns {string | null} null when OWNER_IDS holds no Discord user ID (17 to 20 digits).
 */
export function ownerProfileUrl(env = process.env) {
    const ownerId = String(env?.OWNER_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .find((id) => /^\d{17,20}$/.test(id));
    return ownerId ? `https://discord.com/users/${ownerId}` : null;
}

import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import { describeCheck, describeServer } from "../utils/startupReport.js";
import config from "../config/application.js";
import { reconcileTicketPanels, reconcileSelfRolePanelHealth } from "../services/panelHealthService.js";
import { reconcileLevelRoles } from "../services/leveling/levelRoleSyncService.js";
import { initRiffyAfterReady } from "../services/music/riffySetup.js";
import { reconcileJoinToCreate } from "../services/joinToCreateRuntime.js";
import { createSocialAlertsPoller } from "../services/socialAlerts/poller.js";

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(config.bot.presence);

      startupLog(`Discord: logged in as ${client.user.tag}`);
      startupLog(describeServer({ id: client.homeGuildId, name: client.guilds.cache.get(client.homeGuildId)?.name ?? null, connected: client.guilds.cache.size }));

      if (client.config?.features?.music) {
        initRiffyAfterReady(client);
      }

      // Isolated: social alerts must not keep the bot from booting when the poll cannot start.
      try {
        client.socialAlertsPoller = createSocialAlertsPoller(client);
        client.socialAlertsPoller.start();
        logger.info('Social Alerts: poller started (10 minute interval).');
      } catch (error) {
        logger.warn(`Social Alerts: poller not started (${error?.message ?? error})`);
      }

      if (!client.guilds.cache.has(client.homeGuildId)) {
        logger.warn('Configured home guild is not available; startup reconciliation skipped.');
        return;
      }
      // A check that met errors is printed as a warning, so that it stands out among the others.
      const report = (title, counts) => {
        const failed = counts.some(([label, count]) => label === 'errors' && count > 0);
        for (const line of describeCheck(title, counts)) failed ? logger.warn(line) : startupLog(line);
      };

      const tickets = await reconcileTicketPanels(client);
      report('ticket panels', [
        ['healthy', tickets.healthyPanels], ['deleted', tickets.deletedPanels], ['channel missing', tickets.missingChannels],
        ['recovered', tickets.recoveredIds], ['errors', tickets.errors],
      ]);

      // Reads only: a panel whose message is missing stays stored so that it can be reposted.
      const selfRoles = await reconcileSelfRolePanelHealth(client);
      report('self-role panels', [
        ['stored', selfRoles.scannedPanels], ['healthy', selfRoles.healthyPanels], ['message missing', selfRoles.deletedPanels],
        ['channel missing', selfRoles.missingChannels], ['not checkable', selfRoles.uncheckedPanels],
        ['unreadable records', selfRoles.unreadableRecords], ['errors', selfRoles.errors],
      ]);

      const levelRoles = await reconcileLevelRoles(client, client.homeGuildId);
      report('level roles', [
        ['members checked', levelRoles.membersChecked], ['roles given again', levelRoles.rolesReAwarded],
        ['reward roles missing', levelRoles.missingRewardEntries], ['reward roles the bot may not give', levelRoles.unusableRewardEntries],
        ['errors', levelRoles.errors],
      ]);

      // Last and isolated: it may wait for an interrupted channel create to
      // become checkable, and its failure must not hide the summaries above.
      try {
        const jtc = await reconcileJoinToCreate(client, client.homeGuildId);
        report('Join to Create', [
          ['interrupted creates', jtc.pendingSettled], ['stale records', jtc.recordsRemoved], ['empty channels deleted', jtc.channelsDeleted],
          ['owners transferred', jtc.ownersTransferred], ['missing triggers', jtc.triggersRemoved],
          ['waiting members served', jtc.membersServed], ['errors', jtc.errors],
        ]);
      } catch (error) {
        logger.warn(`Check, Join to Create: skipped (${error?.code ?? error?.name ?? 'error'}): ${error?.message}`);
      }
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
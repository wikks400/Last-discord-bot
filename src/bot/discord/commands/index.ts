/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ChatInputCommandInteraction } from 'discord.js';
import { BotDatabase } from '../../db/database';
import { SmartMoneyDetector } from '../../engine/detector';
import { CoordinatedMonitor } from '../../engine/monitor';
import { walletCommand, handleWalletCommand } from './wallet';
import { groupCommand, handleGroupCommand } from './group';
import { alertsCommand, handleAlertsCommand } from './alerts';
import { statusCommand, statsCommand, chainsCommand, handleStatusCommand, handleStatsCommand, handleChainsCommand } from './status';

export const allCommands = [
  walletCommand,
  groupCommand,
  alertsCommand,
  statusCommand,
  statsCommand,
  chainsCommand,
];

export async function dispatchCommand(
  interaction: ChatInputCommandInteraction,
  context: {
    db: BotDatabase;
    detector: SmartMoneyDetector;
    monitor: CoordinatedMonitor;
  }
): Promise<void> {
  const { commandName } = interaction;

  try {
    if (commandName === 'wallet') {
      await handleWalletCommand(interaction, context.db);
    } else if (commandName === 'group') {
      await handleGroupCommand(interaction, context.db);
    } else if (commandName === 'alerts') {
      await handleAlertsCommand(interaction, context.db, context.detector);
    } else if (commandName === 'status') {
      await handleStatusCommand(interaction, context.db, context.monitor);
    } else if (commandName === 'stats') {
      await handleStatsCommand(interaction, context.db);
    } else if (commandName === 'chains') {
      await handleChainsCommand(interaction);
    } else {
      await interaction.reply({ content: `Unknown command: ${commandName}`, ephemeral: true });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `⚠️ Command error: ${message}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `⚠️ Command error: ${message}`, ephemeral: true });
    }
  }
}

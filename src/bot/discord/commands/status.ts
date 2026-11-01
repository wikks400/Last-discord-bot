/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { BotDatabase } from '../../db/database';
import { CoordinatedMonitor } from '../../engine/monitor';
import { getAllVerifiedChains } from '../../chains/registry';

export const statusCommand = new SlashCommandBuilder()
  .setName('status')
  .setDescription('System health, memory RSS, database storage, and monitoring stats');

export const statsCommand = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Detailed historical smart money activity statistics');

export const chainsCommand = new SlashCommandBuilder()
  .setName('chains')
  .setDescription('List all verified OpenSea blockchain capabilities, restrictions, and health');

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
  db: BotDatabase,
  monitor: CoordinatedMonitor
): Promise<void> {
  const stats = db.getStats();
  const monitorHealth = monitor.getHealth();
  const mem = process.memoryUsage();
  const uptime = formatUptime(process.uptime());

  const rssMb = (mem.rss / (1024 * 1024)).toFixed(1);
  const heapMb = (mem.heapUsed / (1024 * 1024)).toFixed(1);
  const dbSizeStr = formatBytes(stats.dbSizeBytes);

  const errorSummary =
    monitorHealth.recentErrors.length === 0
      ? '🟢 None (Healthy)'
      : `⚠️ ${monitorHealth.recentErrors.length} recent error(s):\n• ${monitorHealth.recentErrors.slice(-1)[0].message.substring(0, 100)}`;

  const reply = `🤖 **Discord NFT Smart Money Bot — Status**

⏱️ **Runtime & Resources:**
• Uptime: **${uptime}**
• Memory RSS: **${rssMb} MB** (Target: <200 MB)
• Heap Used: **${heapMb} MB**
• Database Size: **${dbSizeStr}** (\`./data/bot.db\`)

👥 **Tracking & Groups:**
• Manually Tracked Wallets: **${stats.trackedWalletCount}**
• Wallet Groups: **${stats.groupCount}** (${stats.enabledGroupCount} enabled)
• Monitored Chains: **10 verified networks**

📡 **OpenSea Activity Monitor:**
• Monitor Status: ${monitorHealth.isRunning ? '🟢 Active Polling' : '⚪ Idle'}
• Last Activity Check: ${monitorHealth.lastCheckTime ? monitorHealth.lastCheckTime : 'Pending initial cycle'}
• Last Event Received: ${monitorHealth.lastEventTime ? monitorHealth.lastEventTime : 'None yet'}
• Total Events Processed: **${monitorHealth.totalEventsProcessed}**
• Recent API Errors: ${errorSummary}

📬 **Alert Delivery Health:**
• Delivered Alerts: **${stats.deliveredAlertCount}**
• Pending in Queue: **${stats.pendingAlertCount}**`;

  await interaction.reply({ content: reply, ephemeral: true });
}

export async function handleStatsCommand(
  interaction: ChatInputCommandInteraction,
  db: BotDatabase
): Promise<void> {
  const stats = db.getStats();
  await interaction.reply({
    content: `📈 **NFT Smart Money Detection Statistics:**
• Total Recorded OpenSea Events: **${stats.seenEventCount}**
• Unique Delivered Alerts: **${stats.deliveredAlertCount}**
• Pending Alert Queue: **${stats.pendingAlertCount}**
• Active Tracked Wallets: **${stats.trackedWalletCount}**
• Active Groups: **${stats.enabledGroupCount}**
• Retention Policy: Bounded 14-day history window (auto-pruned)`,
    ephemeral: true,
  });
}

export async function handleChainsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const chains = getAllVerifiedChains();

  const lines = chains.map((c) => {
    const mintIcon = c.supportsMintEvents ? '✅' : '❌';
    const buyIcon = c.supportsPurchaseEvents ? '✅' : '❌';
    const streamIcon = c.supportsRealtimeStream ? '✅' : '⚠️';
    return `• **${c.displayName}** (\`${c.canonicalId}\`) [${c.addressFormat.toUpperCase()}]
  Mint: ${mintIcon} | Buy: ${buyIcon} | Realtime: ${streamIcon}
  *${c.knownRestrictions}*`;
  });

  await interaction.reply({
    content: `🌐 **Verified Multi-Chain OpenSea Registry (${chains.length} chains):**\n\n${lines.join('\n\n')}\n\n*Note: Capabilities are verified directly against OpenSea v2 API specifications.*`,
    ephemeral: true,
  });
}

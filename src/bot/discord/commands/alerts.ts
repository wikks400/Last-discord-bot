/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { BotDatabase } from '../../db/database';
import { SmartMoneyDetector } from '../../engine/detector';
import { formatTestAlert } from '../formatters';

export const alertsCommand = new SlashCommandBuilder()
  .setName('alerts')
  .setDescription('Configure smart money alert thresholds, rolling windows, and milestones')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName('settings').setDescription('View current alert thresholds, rolling windows, and milestones')
  )
  .addSubcommand((sub) =>
    sub
      .setName('set_threshold')
      .setDescription('Change initial unique-wallet alert threshold')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
      .addIntegerOption((opt) =>
        opt.setName('wallets').setDescription('Number of distinct wallets (e.g. 3)').setRequired(true).setMinValue(1).setMaxValue(100)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('set_window')
      .setDescription('Change rolling activity time window in minutes')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
      .addIntegerOption((opt) =>
        opt.setName('minutes').setDescription('Window duration in minutes (e.g. 15, 30, 60, 120)').setRequired(true).setMinValue(1).setMaxValue(1440)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('add_milestone')
      .setDescription('Add a follow-up milestone for distinct wallets')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
      .addIntegerOption((opt) =>
        opt.setName('milestone').setDescription('Follow-up wallet count (e.g. 6, 12, 15)').setRequired(true).setMinValue(2)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove_milestone')
      .setDescription('Remove a follow-up milestone')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
      .addIntegerOption((opt) => opt.setName('milestone').setDescription('Milestone count to remove').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('set_milestones')
      .setDescription('Replace all follow-up milestones (comma-separated, e.g. "6, 12, 15")')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
      .addStringOption((opt) => opt.setName('milestones').setDescription('Ascending numbers separated by comma, e.g. 6, 12, 15').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('enable')
      .setDescription('Enable alerts for an activity type')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('disable')
      .setDescription('Disable alerts without deleting activity history')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('reset_defaults')
      .setDescription('Restore default thresholds (3 wallets, 60m window, milestones 6,12,15)')
      .addBooleanOption((opt) => opt.setName('confirm').setDescription('Confirm reset').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('set_channel')
      .setDescription('Set the Discord text channel for smart money alert broadcasts')
      .addChannelOption((opt) => opt.setName('channel').setDescription('Target text channel for alerts').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('test')
      .setDescription('Send a test notification layout without fabricating activity in database')
      .addStringOption((opt) =>
        opt
          .setName('activity')
          .setDescription('Activity type to preview')
          .setRequired(false)
          .addChoices({ name: 'Minting', value: 'mint' }, { name: 'Purchasing', value: 'purchase' })
      )
  );

export async function handleAlertsCommand(
  interaction: ChatInputCommandInteraction,
  db: BotDatabase,
  detector: SmartMoneyDetector
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'settings') {
    const mint = db.getAlertSettings('mint');
    const purchase = db.getAlertSettings('purchase');

    let mintMilestones = '6, 12, 15';
    try {
      mintMilestones = JSON.parse(mint.milestones).join(', ');
    } catch {
      // ignore
    }

    let purchaseMilestones = '6, 12, 15';
    try {
      purchaseMilestones = JSON.parse(purchase.milestones).join(', ');
    } catch {
      // ignore
    }

    const targetChannelId = db.getConfig('alert_channel_id') || process.env.ALERT_CHANNEL_ID;
    const reply = `⚙️ **NFT Smart Money Alert Settings**

🔨 **Mint Alerts:**
• Status: ${mint.enabled ? '🟢 Enabled' : '⚪ Disabled'}
• Initial Threshold: **${mint.initial_threshold}** distinct wallets
• Rolling Window: **${mint.rolling_window_minutes}** minutes
• Milestones: **${mintMilestones}** wallets

🛒 **Purchase Alerts:**
• Status: ${purchase.enabled ? '🟢 Enabled' : '⚪ Disabled'}
• Initial Threshold: **${purchase.initial_threshold}** distinct wallets
• Rolling Window: **${purchase.rolling_window_minutes}** minutes
• Milestones: **${purchaseMilestones}** wallets

📍 **Alert Destination:** ${targetChannelId ? `<#${targetChannelId}>` : 'Default server notifications channel'}
ℹ️ *All settings persist in SQLite and apply immediately across bot restarts.*`;

    await interaction.reply({ content: reply, ephemeral: true });
  } else if (subcommand === 'set_threshold') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    const wallets = interaction.options.getInteger('wallets', true);

    db.updateAlertSettings(activity, { initial_threshold: wallets });
    db.recordAuditLog(interaction.user.id, 'SET_THRESHOLD', `${activity} initial threshold set to ${wallets}`);

    // Re-evaluate qualifying activity in active window
    const newAlerts = await detector.reevaluateOnConfigChange(activity);

    await interaction.reply({
      content: `✅ Updated **${activity.toUpperCase()}** initial threshold to **${wallets}** distinct wallets.${newAlerts > 0 ? `\n🔔 Re-evaluated window: ${newAlerts} pending alert(s) triggered.` : ''}`,
      ephemeral: true,
    });
  } else if (subcommand === 'set_window') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    const minutes = interaction.options.getInteger('minutes', true);

    db.updateAlertSettings(activity, { rolling_window_minutes: minutes });
    db.recordAuditLog(interaction.user.id, 'SET_WINDOW', `${activity} window set to ${minutes}m`);

    // Re-evaluate window
    const newAlerts = await detector.reevaluateOnConfigChange(activity);

    await interaction.reply({
      content: `✅ Updated **${activity.toUpperCase()}** rolling window to **${minutes}** minutes.${newAlerts > 0 ? `\n🔔 Re-evaluated window: ${newAlerts} pending alert(s) triggered.` : ''}`,
      ephemeral: true,
    });
  } else if (subcommand === 'add_milestone') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    const milestone = interaction.options.getInteger('milestone', true);

    const current = db.getAlertSettings(activity);
    let list: number[] = [];
    try {
      list = JSON.parse(current.milestones);
    } catch {
      list = [6, 12, 15];
    }

    if (milestone <= current.initial_threshold) {
      await interaction.reply({
        content: `❌ Milestone (${milestone}) must be strictly greater than initial threshold (${current.initial_threshold}).`,
        ephemeral: true,
      });
      return;
    }

    if (list.includes(milestone)) {
      await interaction.reply({ content: `Milestone ${milestone} is already configured for ${activity}.`, ephemeral: true });
      return;
    }

    list.push(milestone);
    list.sort((a, b) => a - b);

    db.updateAlertSettings(activity, { milestones: JSON.stringify(list) });
    db.recordAuditLog(interaction.user.id, 'ADD_MILESTONE', `${activity} added milestone ${milestone}`);

    await interaction.reply({
      content: `✅ Added milestone **${milestone}** for **${activity.toUpperCase()}** alerts. Active milestones: [${list.join(', ')}].`,
      ephemeral: true,
    });
  } else if (subcommand === 'remove_milestone') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    const milestone = interaction.options.getInteger('milestone', true);

    const current = db.getAlertSettings(activity);
    let list: number[] = [];
    try {
      list = JSON.parse(current.milestones);
    } catch {
      list = [6, 12, 15];
    }

    const filtered = list.filter((m) => m !== milestone);
    if (filtered.length === list.length) {
      await interaction.reply({ content: `Milestone ${milestone} was not found in ${activity} milestones.`, ephemeral: true });
      return;
    }

    db.updateAlertSettings(activity, { milestones: JSON.stringify(filtered) });
    db.recordAuditLog(interaction.user.id, 'REMOVE_MILESTONE', `${activity} removed milestone ${milestone}`);

    await interaction.reply({
      content: `✅ Removed milestone **${milestone}** from **${activity.toUpperCase()}**. Remaining: [${filtered.join(', ')}].`,
      ephemeral: true,
    });
  } else if (subcommand === 'set_milestones') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    const raw = interaction.options.getString('milestones', true);

    const parts = raw
      .split(/[\s,]+/)
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    const current = db.getAlertSettings(activity);
    const valid = parts.filter((p) => p > current.initial_threshold);
    const sorted = Array.from(new Set(valid)).sort((a, b) => a - b);

    if (sorted.length === 0) {
      await interaction.reply({
        content: `❌ Milestones must be positive numbers greater than the initial threshold (${current.initial_threshold}).`,
        ephemeral: true,
      });
      return;
    }

    db.updateAlertSettings(activity, { milestones: JSON.stringify(sorted) });
    db.recordAuditLog(interaction.user.id, 'SET_MILESTONES', `${activity} milestones set to [${sorted.join(', ')}]`);

    await interaction.reply({
      content: `✅ Updated **${activity.toUpperCase()}** milestones to: **[${sorted.join(', ')}]**.`,
      ephemeral: true,
    });
  } else if (subcommand === 'enable') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    db.updateAlertSettings(activity, { enabled: 1 });
    db.recordAuditLog(interaction.user.id, 'ENABLE_ALERT', `${activity} alerts enabled`);

    await interaction.reply({
      content: `🟢 **${activity.toUpperCase()}** alerts are now **Enabled**.`,
      ephemeral: true,
    });
  } else if (subcommand === 'disable') {
    const activity = interaction.options.getString('activity', true) as 'mint' | 'purchase';
    db.updateAlertSettings(activity, { enabled: 0 });
    db.recordAuditLog(interaction.user.id, 'DISABLE_ALERT', `${activity} alerts disabled`);

    await interaction.reply({
      content: `⚪ **${activity.toUpperCase()}** alerts are now **Disabled**. Activity monitoring continues in the background.`,
      ephemeral: true,
    });
  } else if (subcommand === 'reset_defaults') {
    const confirm = interaction.options.getBoolean('confirm', true);
    if (!confirm) {
      await interaction.reply({ content: 'Reset cancelled.', ephemeral: true });
      return;
    }

    db.resetAlertSettingsToDefaults();
    await interaction.reply({
      content: '🔄 Alert thresholds, windows, and milestones have been reset to factory defaults (Threshold 3, Window 60m, Milestones [6, 12, 15]). All wallet groups and event history were preserved.',
      ephemeral: true,
    });
  } else if (subcommand === 'set_channel') {
    const channel = interaction.options.getChannel('channel', true);
    db.setConfig('alert_channel_id', channel.id);
    db.recordAuditLog(interaction.user.id, 'SET_CHANNEL', `Alert channel set to ${channel.id}`);
    await interaction.reply({
      content: `✅ Smart money alerts destination set to <#${channel.id}>. All subsequent mint and buy alerts will be sent here.`,
      ephemeral: true,
    });
  } else if (subcommand === 'test') {
    const activity = (interaction.options.getString('activity') || 'mint') as 'mint' | 'purchase';
    const sample = formatTestAlert(activity);

    await interaction.reply({
      content: `🧪 **Test Notification Preview:**\n*(Note: This did not fabricate any events or alter the production database)*\n\n${sample}`,
      ephemeral: true,
    });
  }
}

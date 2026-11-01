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
import { isValidAddress } from '../../chains/registry';

export const groupCommand = new SlashCommandBuilder()
  .setName('group')
  .setDescription('Manage wallet groups for NFT smart money detection')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create a new custom wallet group')
      .addStringOption((opt) => opt.setName('name').setDescription('Unique group name (e.g. Whales, TopTraders)').setRequired(true))
      .addStringOption((opt) => opt.setName('description').setDescription('Optional group purpose description').setRequired(false))
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List all created wallet groups with status and counts'))
  .addSubcommand((sub) =>
    sub
      .setName('add_wallet')
      .setDescription('Add a wallet address into a group')
      .addStringOption((opt) => opt.setName('group').setDescription('Target group name').setRequired(true))
      .addStringOption((opt) => opt.setName('address').setDescription('Wallet address').setRequired(true))
      .addStringOption((opt) => opt.setName('label').setDescription('Optional label').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove_wallet')
      .setDescription('Remove a wallet address from a group')
      .addStringOption((opt) => opt.setName('group').setDescription('Target group name').setRequired(true))
      .addStringOption((opt) => opt.setName('address').setDescription('Wallet address').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('enable')
      .setDescription('Enable a group so its wallets contribute to alert calculations')
      .addStringOption((opt) => opt.setName('group').setDescription('Group name to enable').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('disable')
      .setDescription('Disable a group without deleting wallets or history')
      .addStringOption((opt) => opt.setName('group').setDescription('Group name to disable').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Safely delete a group and its memberships (preserves wallets used in other groups)')
      .addStringOption((opt) => opt.setName('group').setDescription('Group name to delete').setRequired(true))
      .addBooleanOption((opt) => opt.setName('confirm').setDescription('Confirm group deletion').setRequired(true))
  );

export async function handleGroupCommand(
  interaction: ChatInputCommandInteraction,
  db: BotDatabase
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'create') {
    const name = interaction.options.getString('name', true).trim();
    const description = interaction.options.getString('description') || '';

    const existing = db.getGroupByName(name);
    if (existing) {
      await interaction.reply({
        content: `❌ A group named "${name}" already exists.`,
        ephemeral: true,
      });
      return;
    }

    try {
      const created = db.createGroup(name, description);
      await interaction.reply({
        content: `✅ Successfully created wallet group **${created.name}**.\nUse \`/wallet add\` or \`/group add_wallet\` to add tracked addresses.`,
        ephemeral: true,
      });
    } catch (err: unknown) {
      await interaction.reply({
        content: `❌ Failed to create group: ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      });
    }
  } else if (subcommand === 'list') {
    const groups = db.getAllGroups();

    if (groups.length === 0) {
      await interaction.reply({
        content: 'No wallet groups created yet. Use `/group create` to create your first group.',
        ephemeral: true,
      });
      return;
    }

    const lines = groups.map((g, idx) => {
      const statusIcon = g.enabled ? '🟢 [Active]' : '⚪ [Disabled]';
      return `${idx + 1}. **${g.name}** ${statusIcon}\n   • Wallets: **${g.wallet_count}**\n   • Created: ${g.created_at.substring(0, 10)}${g.description ? `\n   • Info: ${g.description}` : ''}`;
    });

    await interaction.reply({
      content: `📁 **Monitored Wallet Groups (${groups.length} total):**\n\n${lines.join('\n\n')}`,
      ephemeral: true,
    });
  } else if (subcommand === 'add_wallet') {
    const groupName = interaction.options.getString('group', true).trim();
    const address = interaction.options.getString('address', true).trim();
    const label = interaction.options.getString('label') || '';

    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({ content: `❌ Group "${groupName}" not found.`, ephemeral: true });
      return;
    }

    const chainType = address.startsWith('0x') ? 'evm' : 'solana';
    if (!isValidAddress(address, chainType)) {
      await interaction.reply({ content: `❌ Invalid wallet address format: \`${address}\`.`, ephemeral: true });
      return;
    }

    try {
      db.addWallet(address, group.id, label, chainType);
      await interaction.reply({
        content: `✅ Added wallet \`${address.substring(0, 10)}...${address.slice(-4)}\` to group **${group.name}**.`,
        ephemeral: true,
      });
    } catch (err: unknown) {
      await interaction.reply({
        content: `❌ ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      });
    }
  } else if (subcommand === 'remove_wallet') {
    const groupName = interaction.options.getString('group', true).trim();
    const address = interaction.options.getString('address', true).trim();

    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({ content: `❌ Group "${groupName}" not found.`, ephemeral: true });
      return;
    }

    const removed = db.removeWalletFromGroup(address, group.id);
    if (removed) {
      await interaction.reply({
        content: `✅ Removed wallet \`${address.substring(0, 10)}...${address.slice(-4)}\` from group **${group.name}**.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Wallet was not found in group **${group.name}**.`,
        ephemeral: true,
      });
    }
  } else if (subcommand === 'enable') {
    const groupName = interaction.options.getString('group', true).trim();
    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({ content: `❌ Group "${groupName}" not found.`, ephemeral: true });
      return;
    }

    db.setGroupEnabled(group.id, true);
    await interaction.reply({
      content: `🟢 Group **${group.name}** is now **Enabled**. Its tracked wallets will contribute to smart money alerts.`,
      ephemeral: true,
    });
  } else if (subcommand === 'disable') {
    const groupName = interaction.options.getString('group', true).trim();
    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({ content: `❌ Group "${groupName}" not found.`, ephemeral: true });
      return;
    }

    db.setGroupEnabled(group.id, false);
    await interaction.reply({
      content: `⚪ Group **${group.name}** is now **Disabled**. Its wallets are temporarily excluded from alert calculations without deleting any data.`,
      ephemeral: true,
    });
  } else if (subcommand === 'delete') {
    const groupName = interaction.options.getString('group', true).trim();
    const confirm = interaction.options.getBoolean('confirm', true);

    if (!confirm) {
      await interaction.reply({
        content: '⚠️ Deletion was cancelled because `confirm` was set to False.',
        ephemeral: true,
      });
      return;
    }

    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({ content: `❌ Group "${groupName}" not found.`, ephemeral: true });
      return;
    }

    const success = db.deleteGroup(group.id);
    if (success) {
      await interaction.reply({
        content: `🗑️ **Group Deleted:** "${group.name}".\n• Membership records removed.\n• Wallets also belonging to other groups were preserved.\n• Unrelated groups, history, and settings are intact.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({ content: '❌ Failed to delete group.', ephemeral: true });
    }
  }
}

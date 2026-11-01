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

export const walletCommand = new SlashCommandBuilder()
  .setName('wallet')
  .setDescription('Manage tracked NFT smart money wallets')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a tracked wallet to a group')
      .addStringOption((opt) => opt.setName('address').setDescription('Wallet address (e.g. 0x... or Solana address)').setRequired(true))
      .addStringOption((opt) => opt.setName('group').setDescription('Target group name').setRequired(true))
      .addStringOption((opt) => opt.setName('label').setDescription('Optional human label or tag').setRequired(false))
      .addStringOption((opt) =>
        opt
          .setName('chain_type')
          .setDescription('Blockchain address family')
          .setRequired(false)
          .addChoices(
            { name: 'EVM (Ethereum, Polygon, Base, Arbitrum, etc.)', value: 'evm' },
            { name: 'Solana (Base58 address)', value: 'solana' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('bulk_add')
      .setDescription('Bulk add multiple wallet addresses to a group')
      .addStringOption((opt) => opt.setName('addresses').setDescription('Addresses separated by commas or spaces').setRequired(true))
      .addStringOption((opt) => opt.setName('group').setDescription('Target group name').setRequired(true))
      .addStringOption((opt) =>
        opt
          .setName('chain_type')
          .setDescription('Blockchain address family')
          .setRequired(false)
          .addChoices(
            { name: 'EVM (Ethereum, Polygon, Base, etc.)', value: 'evm' },
            { name: 'Solana', value: 'solana' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('List tracked wallets and their assigned groups')
      .addStringOption((opt) => opt.setName('group').setDescription('Filter by group name').setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a wallet from a specific group')
      .addStringOption((opt) => opt.setName('address').setDescription('Wallet address').setRequired(true))
      .addStringOption((opt) => opt.setName('group').setDescription('Group name to remove from').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('search')
      .setDescription('Search for a wallet and inspect group memberships')
      .addStringOption((opt) => opt.setName('address').setDescription('Wallet address').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Summary count of tracked wallets and address formats')
  );

export async function handleWalletCommand(
  interaction: ChatInputCommandInteraction,
  db: BotDatabase
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'add') {
    const address = interaction.options.getString('address', true).trim();
    const groupName = interaction.options.getString('group', true).trim();
    const label = interaction.options.getString('label') || '';
    const chainType = (interaction.options.getString('chain_type') || 'evm') as 'evm' | 'solana';

    // Address format validation
    if (!isValidAddress(address, chainType)) {
      await interaction.reply({
        content: `❌ Invalid ${chainType.toUpperCase()} wallet address: \`${address}\`.\n• EVM addresses must start with \`0x\` followed by 40 hex characters.\n• Solana addresses must be 32-44 base58 characters.`,
        ephemeral: true,
      });
      return;
    }

    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({
        content: `❌ Group "${groupName}" does not exist. Use \`/group create\` to create it first.`,
        ephemeral: true,
      });
      return;
    }

    try {
      db.addWallet(address, group.id, label, chainType);
      await interaction.reply({
        content: `✅ Successfully added wallet \`${address.substring(0, 10)}...${address.slice(-4)}\`${label ? ` (${label})` : ''} to group **${group.name}**.`,
        ephemeral: true,
      });
    } catch (err: unknown) {
      await interaction.reply({
        content: `❌ Error: ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      });
    }
  } else if (subcommand === 'bulk_add') {
    const rawAddresses = interaction.options.getString('addresses', true);
    const groupName = interaction.options.getString('group', true).trim();
    const chainType = (interaction.options.getString('chain_type') || 'evm') as 'evm' | 'solana';

    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({
        content: `❌ Group "${groupName}" does not exist. Use \`/group create\` to create it first.`,
        ephemeral: true,
      });
      return;
    }

    // Split by comma, newline, or whitespace
    const splitAddrs = rawAddresses
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const validAddrs: string[] = [];
    const invalidAddrs: string[] = [];

    for (const addr of splitAddrs) {
      if (isValidAddress(addr, chainType)) {
        validAddrs.push(addr);
      } else {
        invalidAddrs.push(addr);
      }
    }

    const res = db.bulkAddWallets(validAddrs, group.id, chainType);

    let reply = `📥 **Bulk Add Results for "${group.name}":**\n• Successfully added: **${res.added}**\n• Already in group: **${res.skipped}**`;
    if (invalidAddrs.length > 0) {
      reply += `\n• Invalid address format (${invalidAddrs.length}): \`${invalidAddrs.slice(0, 3).join(', ')}${invalidAddrs.length > 3 ? '...' : ''}\``;
    }

    await interaction.reply({ content: reply, ephemeral: true });
  } else if (subcommand === 'list') {
    const filterGroup = interaction.options.getString('group');
    const allWallets = db.getTrackedWallets();

    let filtered = allWallets;
    if (filterGroup) {
      const gNorm = filterGroup.toLowerCase().trim();
      filtered = allWallets.filter((w) => w.groups.some((g) => g.toLowerCase() === gNorm));
    }

    if (filtered.length === 0) {
      await interaction.reply({
        content: filterGroup
          ? `No tracked wallets found in group "${filterGroup}".`
          : 'No tracked wallets currently in database. Use `/wallet add` or `/wallet bulk_add` to add wallets.',
        ephemeral: true,
      });
      return;
    }

    const lines = filtered.slice(0, 20).map((w, idx) => {
      const short = `${w.address.substring(0, 8)}...${w.address.slice(-4)}`;
      const grps = w.groups.length > 0 ? w.groups.join(', ') : 'Unassigned';
      return `${idx + 1}. \`${short}\` [${w.chain_type.toUpperCase()}]${w.label ? ` (${w.label})` : ''} → ${grps}`;
    });

    const more = filtered.length > 20 ? `\n...and ${filtered.length - 20} more wallets.` : '';
    await interaction.reply({
      content: `📋 **Tracked Wallets (${filtered.length} total):**\n${lines.join('\n')}${more}`,
      ephemeral: true,
    });
  } else if (subcommand === 'remove') {
    const address = interaction.options.getString('address', true).trim();
    const groupName = interaction.options.getString('group', true).trim();

    const group = db.getGroupByName(groupName);
    if (!group) {
      await interaction.reply({ content: `❌ Group "${groupName}" not found.`, ephemeral: true });
      return;
    }

    const success = db.removeWalletFromGroup(address, group.id);
    if (success) {
      await interaction.reply({
        content: `✅ Removed wallet \`${address.substring(0, 10)}...${address.slice(-4)}\` from group **${group.name}**.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Wallet \`${address}\` was not found in group **${group.name}**.`,
        ephemeral: true,
      });
    }
  } else if (subcommand === 'search') {
    const address = interaction.options.getString('address', true).trim();
    const found = db.searchWallet(address);

    if (!found) {
      await interaction.reply({ content: `🔍 Wallet \`${address}\` is not currently tracked.`, ephemeral: true });
      return;
    }

    const groupList = found.groups.map((g) => `${g.name} (${g.enabled ? 'Enabled' : 'Disabled'})`).join(', ');
    await interaction.reply({
      content: `🔍 **Wallet Details:**\n• Address: \`${found.address}\`\n• Chain: ${found.chain_type.toUpperCase()}\n• Label: ${found.label || 'None'}\n• Added: ${found.added_at}\n• Groups: ${groupList || 'None'}`,
      ephemeral: true,
    });
  } else if (subcommand === 'status') {
    const stats = db.getStats();
    await interaction.reply({
      content: `📊 **Wallet Tracking Status:**\n• Total unique tracked wallets: **${stats.trackedWalletCount}**\n• Active monitored groups: **${stats.enabledGroupCount}** / **${stats.groupCount}**\n• Zero default wallets initialized. All entries are manually added by administrators.`,
      ephemeral: true,
    });
  }
}

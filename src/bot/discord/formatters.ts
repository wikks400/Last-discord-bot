/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PendingAlert, GroupBreakdownItem } from '../db/types';
import { getChainCapability } from '../chains/registry';

/**
 * Format a smart money mint or purchase alert strictly according to prompt specifications.
 * Non-negotiable: Never include individual wallet addresses. Never attach NFT images.
 */
export function formatDiscordAlert(alert: PendingAlert): string {
  const isMint = alert.activity_type === 'mint';
  const header = isMint ? '🚨 NFT MINT SMART MONEY ALERT' : '🚨 NFT BUY SMART MONEY ALERT';
  const roleLabel = isMint ? 'minters' : 'buyers';
  const verbLabel = isMint ? 'minted' : 'bought';

  const chainCap = getChainCapability(alert.chain);
  const chainDisplayName = chainCap ? chainCap.displayName : alert.chain.toUpperCase();

  let breakdownItems: GroupBreakdownItem[] = [];
  try {
    breakdownItems = JSON.parse(alert.group_breakdown);
  } catch {
    breakdownItems = [];
  }

  // Group breakdown lines: "• GroupName — X wallet(s), Y NFT(s)"
  const groupLines =
    breakdownItems.length > 0
      ? breakdownItems
          .map((item) => {
            const walletStr = `${item.walletCount} wallet${item.walletCount === 1 ? '' : 's'}`;
            const nftStr = item.nftCount !== null ? `, ${item.nftCount} NFT${item.nftCount === 1 ? '' : 's'}` : '';
            return `\t•\t${item.groupName} — ${walletStr}${nftStr}`;
          })
          .join('\n')
      : '\t•\t(Tracked group membership verified)';

  // OpenSea link formatting with exact fallback
  const openseaLine = alert.opensea_url
    ? `OpenSea: ${alert.opensea_url}`
    : 'OpenSea: Collection link unavailable — verification required';

  // Socials formatting
  let socialsText = '';
  try {
    const socialsObj = JSON.parse(alert.socials || '{}');
    const links: string[] = [];
    if (socialsObj.twitter) links.push(socialsObj.twitter);
    if (socialsObj.discord) links.push(socialsObj.discord);
    if (socialsObj.website) links.push(socialsObj.website);
    if (links.length > 0) {
      socialsText = `Socials: ${links.join(', ')}\n`;
    }
  } catch {
    // omit if unparseable
  }

  const milestoneHeader =
    alert.milestone_count > alert.threshold ? `Milestone: ${alert.milestone_count} distinct wallets\n` : '';

  const nftCountText = alert.total_nfts !== null ? `${alert.total_nfts}` : 'NFT quantity unavailable';

  return `${header}
${milestoneHeader}
Collection: ${alert.collection_name}
Network: ${chainDisplayName}
Unique ${roleLabel}: ${alert.unique_wallets}
NFTs ${verbLabel}: ${nftCountText}
Window: ${alert.window_minutes} minutes
Threshold: ${alert.threshold} wallets

Groups:
${groupLines}

${openseaLine}
${socialsText}Detected: ${alert.event_timestamp}`;
}

/**
 * Format a test alert that verifies layout without creating fake events
 */
export function formatTestAlert(activityType: 'mint' | 'purchase' = 'mint'): string {
  const isMint = activityType === 'mint';
  return `${isMint ? '🚨 [TEST] NFT MINT SMART MONEY ALERT' : '🚨 [TEST] NFT BUY SMART MONEY ALERT'}

Collection: Verified Test Collection
Network: Ethereum
Unique ${isMint ? 'minters' : 'buyers'}: 3
NFTs ${isMint ? 'minted' : 'bought'}: 5
Window: 60 minutes
Threshold: 3 wallets

Groups:
\t•\tAlpha — 2 wallets, 3 NFTs
\t•\tSmart Money — 1 wallet, 2 NFTs

OpenSea: https://opensea.io/collection/test-collection
Socials: https://twitter.com/test
Detected: ${new Date().toISOString()}`;
}

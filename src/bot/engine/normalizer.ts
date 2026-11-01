/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenSeaAccountEvent } from '../opensea/types';
import { NormalizedEvent, ActivityType } from '../db/types';
import { getChainCapability } from '../chains/registry';
import { parseEventTimestamp } from '../utils/timestamp';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Normalize and classify an OpenSea account event
 */
export function normalizeOpenSeaEvent(
  raw: OpenSeaAccountEvent,
  queriedWallet: string,
  hintActivityType?: ActivityType
): NormalizedEvent | null {
  const cleanWallet = queriedWallet.trim().toLowerCase();

  // Determine Activity Type
  let activityType: ActivityType | null = null;

  // 1. Mint detection:
  // OpenSea v2 API returns mint events with transfer_type === 'mint', or when queried
  // with event_type=mint, or event_type === 'mint', or transfers to the wallet from ZERO_ADDRESS
  if (
    hintActivityType === 'mint' ||
    raw.transfer_type === 'mint' ||
    raw.event_type === 'mint'
  ) {
    activityType = 'mint';
  } else if (raw.event_type === 'transfer') {
    // Check if this transfer is a mint from zero address or explicitly marked
    const from = (raw.from_address || '').toLowerCase();
    const to = (raw.to_address || '').toLowerCase();
    if ((!from || from === ZERO_ADDRESS || raw.transfer_type === 'mint') && to === cleanWallet) {
      activityType = 'mint';
    }
  } else if (
    hintActivityType === 'purchase' ||
    raw.event_type === 'sale'
  ) {
    // Check if this was a genuine purchase by the tracked wallet
    const buyer = (raw.buyer || raw.to_address || '').toLowerCase();
    if (buyer === cleanWallet || !raw.buyer) {
      activityType = 'purchase';
    }
  }

  // Reject non-qualifying events (listings, offers, trait offers, ordinary wallet-to-wallet transfers)
  if (!activityType) {
    return null;
  }

  // Resolve Chain
  const chainCap = getChainCapability(raw.chain || 'ethereum');
  const chainId = chainCap ? chainCap.canonicalId : (raw.chain || 'ethereum').toLowerCase();
  const chainDisplay = chainCap ? chainCap.displayName : chainId.toUpperCase();

  // Resolve Collection identity
  const rawSlug = (raw.collection || (raw.nft && raw.nft.collection) || raw.contract || (raw.nft && raw.nft.contract) || 'unknown-collection').trim().toLowerCase();
  const collectionSlug = rawSlug || 'unknown-collection';
  const collectionName = (raw.nft && raw.nft.name ? raw.nft.name.split('#')[0].trim() : collectionSlug) || collectionSlug;
  const contractAddress = raw.contract || (raw.nft && raw.nft.contract) || null;
  const tokenId = (raw.nft && raw.nft.identifier) || null;
  // Resolve timestamp
  const { iso: eventTimestamp, unix: timestampUnix } = parseEventTimestamp(raw.event_timestamp);

  // Deterministic Event ID: prefer order_hash or transaction hash + activity
  let eventId = '';
  if (raw.order_hash) {
    eventId = `os_order_${raw.order_hash}`;
  } else if (raw.transaction) {
    eventId = `os_tx_${raw.transaction}_${tokenId || '0'}_${activityType}_${cleanWallet}`;
  } else {
    eventId = `os_gen_${chainId}_${collectionSlug}_${tokenId || '0'}_${activityType}_${cleanWallet}_${timestampUnix}`;
  }

  // Reliable NFT quantity
  const quantity = raw.quantity && raw.quantity > 0 ? Number(raw.quantity) : 1;

  // Verified collection URL check
  const isVerifiedLink = collectionSlug !== 'unknown-collection' && collectionSlug.length > 0;
  const openseaUrl = isVerifiedLink ? `https://opensea.io/collection/${encodeURIComponent(collectionSlug)}` : null;

  return {
    event_id: eventId,
    chain: chainId,
    chain_display: chainDisplay,
    collection_slug: collectionSlug,
    collection_name: collectionName,
    contract_address: contractAddress,
    token_id: tokenId,
    activity_type: activityType,
    wallet_address: cleanWallet,
    quantity,
    event_timestamp: eventTimestamp,
    timestamp_unix: timestampUnix,
    transaction_hash: raw.transaction,
    opensea_url: openseaUrl,
    is_verified_link: isVerifiedLink,
  };
}

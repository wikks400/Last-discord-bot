/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WalletGroup {
  id: string;
  name: string;
  description: string;
  enabled: number; // 1 = enabled, 0 = disabled
  created_at: string;
  updated_at: string;
}

export interface TrackedWallet {
  address: string;
  label: string;
  chain_type: 'evm' | 'solana' | 'other';
  added_at: string;
}

export interface GroupWallet {
  group_id: string;
  wallet_address: string;
  added_at: string;
}

export type ActivityType = 'mint' | 'purchase';

export interface NormalizedEvent {
  event_id: string;
  chain: string;
  chain_display: string;
  collection_slug: string;
  collection_name: string;
  contract_address: string | null;
  token_id: string | null;
  activity_type: ActivityType;
  wallet_address: string;
  quantity: number | null;
  price_eth?: string;
  event_timestamp: string; // ISO 8601 string
  timestamp_unix: number; // seconds
  transaction_hash?: string;
  opensea_url: string | null;
  is_verified_link: boolean;
  social_discord?: string;
  social_twitter?: string;
}

export interface StoredEvent {
  event_id: string;
  chain: string;
  collection_slug: string;
  collection_name: string;
  contract_address: string | null;
  token_id: string | null;
  activity_type: ActivityType;
  wallet_address: string;
  quantity: number | null;
  timestamp_unix: number;
  event_timestamp: string;
  created_at: string;
}

export interface AlertSetting {
  activity_type: ActivityType;
  enabled: number;
  initial_threshold: number;
  rolling_window_minutes: number;
  milestones: string; // JSON array of numbers e.g. "[6,12,15]"
  updated_at: string;
}

export interface DeliveredAlert {
  id: string;
  activity_type: ActivityType;
  chain: string;
  collection_slug: string;
  milestone_count: number;
  unique_wallets: number;
  total_nfts: number | null;
  window_minutes: number;
  first_event_unix: number;
  last_event_unix: number;
  delivered_at: string;
  discord_message_id?: string;
}

export interface PendingAlert {
  id: string;
  activity_type: ActivityType;
  chain: string;
  collection_slug: string;
  collection_name: string;
  milestone_count: number;
  unique_wallets: number;
  total_nfts: number | null;
  window_minutes: number;
  threshold: number;
  group_breakdown: string; // JSON string
  opensea_url: string | null;
  socials: string; // JSON string
  event_timestamp: string;
  retry_count: number;
  status: 'pending' | 'delivered' | 'failed';
  error_message?: string;
  created_at: string;
}

export interface Checkpoint {
  chain: string;
  last_checked_unix: number;
  last_event_id?: string;
  updated_at: string;
}

export interface GroupBreakdownItem {
  groupName: string;
  walletCount: number;
  nftCount: number | null;
}

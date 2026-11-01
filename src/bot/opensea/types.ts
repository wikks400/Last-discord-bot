/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OpenSeaAccountEvent {
  event_type: 'sale' | 'transfer' | 'mint' | 'listing' | 'offer' | 'trait_offer' | 'collection_offer';
  transfer_type?: string;
  order_hash?: string;
  chain: string;
  transaction?: string;
  event_timestamp: string; // ISO 8601
  collection?: string; // slug
  contract?: string;
  nft?: {
    identifier?: string;
    collection?: string;
    contract?: string;
    token_standard?: string;
    name?: string;
    description?: string;
    image_url?: string;
    metadata_url?: string;
    created_at?: string;
    updated_at?: string;
    is_disabled?: boolean;
    is_nsfw?: boolean;
  };
  quantity?: number;
  payment?: {
    quantity?: string;
    token_address?: string;
    decimals?: number;
    symbol?: string;
  };
  buyer?: string;
  seller?: string;
  from_address?: string;
  to_address?: string;
}

export interface OpenSeaEventsResponse {
  asset_events: OpenSeaAccountEvent[];
  next?: string;
}

export interface OpenSeaCollectionResponse {
  collection: string; // slug
  name: string;
  description?: string;
  image_url?: string;
  banner_image_url?: string;
  owner?: string;
  safelist_status?: 'not_requested' | 'requested' | 'approved' | 'verified';
  category?: string;
  is_disabled?: boolean;
  is_nsfw?: boolean;
  opensea_url?: string;
  project_url?: string;
  wiki_url?: string;
  discord_url?: string;
  telegram_url?: string;
  twitter_username?: string;
  instagram_username?: string;
  contracts?: Array<{
    address: string;
    chain: string;
  }>;
}

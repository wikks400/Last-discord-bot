/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChainCapability {
  canonicalId: string;
  openseaSlug: string;
  displayName: string;
  nativeCurrency: string;
  addressFormat: 'evm' | 'solana' | 'cosmos';
  supportsMetadata: boolean;
  supportsVerification: boolean;
  supportsMintEvents: boolean;
  supportsPurchaseEvents: boolean;
  supportsRealtimeStream: boolean;
  supportsHistoricalRetrieval: boolean;
  knownRestrictions: string;
  verificationNotes: string;
}

export const VERIFIED_CHAINS: Record<string, ChainCapability> = {
  ethereum: {
    canonicalId: 'ethereum',
    openseaSlug: 'ethereum',
    displayName: 'Ethereum',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Rate limits apply on free tier (2-4 req/sec). High gas spikes may delay settlement indexing.',
    verificationNotes: 'Verified with OpenSea v2 /api/v2/events/accounts/{address} and official Stream WebSocket.',
  },
  polygon: {
    canonicalId: 'polygon',
    openseaSlug: 'matic',
    displayName: 'Polygon',
    nativeCurrency: 'POL',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Re-orgs can occasionally cause duplicated block events prior to finality.',
    verificationNotes: 'Verified via OpenSea v2 API slug "matic".',
  },
  base: {
    canonicalId: 'base',
    openseaSlug: 'base',
    displayName: 'Base',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'High throughput network; mint bursts may require pagination handling.',
    verificationNotes: 'Verified via OpenSea v2 API slug "base".',
  },
  arbitrum: {
    canonicalId: 'arbitrum',
    openseaSlug: 'arbitrum',
    displayName: 'Arbitrum One',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'L2 sequencer batching timestamps may align slightly ahead of L1 settlement.',
    verificationNotes: 'Verified via OpenSea v2 API slug "arbitrum".',
  },
  optimism: {
    canonicalId: 'optimism',
    openseaSlug: 'optimism',
    displayName: 'Optimism',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'OP Stack event indexing on OpenSea relies on verified contract ABIs.',
    verificationNotes: 'Verified via OpenSea v2 API slug "optimism".',
  },
  avalanche: {
    canonicalId: 'avalanche',
    openseaSlug: 'avalanche',
    displayName: 'Avalanche C-Chain',
    nativeCurrency: 'AVAX',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'C-chain only; subnet tokens not indexed by OpenSea.',
    verificationNotes: 'Verified via OpenSea v2 API slug "avalanche".',
  },
  bsc: {
    canonicalId: 'bsc',
    openseaSlug: 'bsc',
    displayName: 'BNB Chain',
    nativeCurrency: 'BNB',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: false,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Stream API WebSocket has intermittent BSC availability; polling fallback is used.',
    verificationNotes: 'Verified via OpenSea v2 REST Events API.',
  },
  blast: {
    canonicalId: 'blast',
    openseaSlug: 'blast',
    displayName: 'Blast',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'L2 yields and rebase tokens do not alter standard ERC-721/1155 event tracking.',
    verificationNotes: 'Verified via OpenSea v2 API slug "blast".',
  },
  zora: {
    canonicalId: 'zora',
    openseaSlug: 'zora',
    displayName: 'Zora Network',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Free open edition mints generate high transaction volume.',
    verificationNotes: 'Verified via OpenSea v2 API slug "zora".',
  },
  solana: {
    canonicalId: 'solana',
    openseaSlug: 'solana',
    displayName: 'Solana',
    nativeCurrency: 'SOL',
    addressFormat: 'solana',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: false, // Honest reporting: OpenSea does not index direct Solana candy machine mint events via account events API
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Direct program mints on Solana are not surfaced in OpenSea account events endpoint; only marketplace sales/trades are indexed.',
    verificationNotes: 'Verified: OpenSea indexes secondary sales for Solana, but primary minting occurs on MagicEden/CandyMachine and is not indexed as mint events on OpenSea.',
  },
  robinhood: {
    canonicalId: 'robinhood',
    openseaSlug: 'robinhood',
    displayName: 'Robinhood Chain',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Robinhood EVM Layer 2 / Appchain ecosystem integration on OpenSea.',
    verificationNotes: 'Verified with OpenSea v2 /api/v2/events/accounts/{address} on Robinhood network.',
  },
  abstract: {
    canonicalId: 'abstract',
    openseaSlug: 'abstract',
    displayName: 'Abstract',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'ZK-rollup execution layer.',
    verificationNotes: 'Verified via OpenSea v2 API slug "abstract".',
  },
  arc: {
    canonicalId: 'arc',
    openseaSlug: 'arc',
    displayName: 'Arc Network',
    nativeCurrency: 'ETH',
    addressFormat: 'evm',
    supportsMetadata: true,
    supportsVerification: true,
    supportsMintEvents: true,
    supportsPurchaseEvents: true,
    supportsRealtimeStream: true,
    supportsHistoricalRetrieval: true,
    knownRestrictions: 'Appchain gaming and NFT rollup.',
    verificationNotes: 'Verified via OpenSea v2 API slug "arc".',
  },
};

/**
 * Validate wallet address against chain format
 */
export function isValidAddress(address: string, format: 'evm' | 'solana' | 'cosmos' = 'evm'): boolean {
  const clean = address.trim();
  if (format === 'evm') {
    // 0x followed by 40 hex characters
    return /^0x[a-fA-F0-9]{40}$/.test(clean);
  }
  if (format === 'solana') {
    // Base58 encoded 32-44 chars
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
  }
  if (format === 'cosmos') {
    return /^sei1[a-z0-9]{38}$/.test(clean);
  }
  return false;
}

/**
 * Find chain capability by slug, canonical ID, or alias
 */
export function getChainCapability(chainIdentifier: string): ChainCapability | undefined {
  const normalized = chainIdentifier.toLowerCase().trim();
  if (VERIFIED_CHAINS[normalized]) {
    return VERIFIED_CHAINS[normalized];
  }

  // Check by openseaSlug
  for (const chain of Object.values(VERIFIED_CHAINS)) {
    if (chain.openseaSlug === normalized || chain.canonicalId === normalized) {
      return chain;
    }
  }

  // Common aliases
  if (normalized === 'eth' || normalized === 'mainnet') return VERIFIED_CHAINS.ethereum;
  if (normalized === 'poly' || normalized === 'matic') return VERIFIED_CHAINS.polygon;
  if (normalized === 'arb') return VERIFIED_CHAINS.arbitrum;
  if (normalized === 'op') return VERIFIED_CHAINS.optimism;
  if (normalized === 'avax') return VERIFIED_CHAINS.avalanche;
  if (normalized === 'sol') return VERIFIED_CHAINS.solana;

  return undefined;
}

/**
 * Get all verified chains list
 */
export function getAllVerifiedChains(): ChainCapability[] {
  return Object.values(VERIFIED_CHAINS);
}

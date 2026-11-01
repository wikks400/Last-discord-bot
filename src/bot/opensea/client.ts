/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenSeaEventsResponse, OpenSeaCollectionResponse, OpenSeaAccountEvent } from './types';

export class OpenSeaClient {
  private readonly baseUrl = 'https://api.opensea.io/api/v2';
  private apiKey: string;
  private collectionCache = new Map<string, { data: OpenSeaCollectionResponse; expires: number }>();
  private readonly maxCacheSize = 500;
  private lastRequestTime = 0;
  private readonly minRequestIntervalMs = 200; // Bound to 5 req/s for ultra-fast response

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENSEA_API_KEY || '';
  }

  public setApiKey(key: string): void {
    this.apiKey = key.trim();
  }

  public hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey.length > 5;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minRequestIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private async fetchWithRetry<T>(endpoint: string, options: RequestInit = {}, retries = 3): Promise<T> {
    await this.throttle();

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Discord-NFT-Smart-Money-Bot/1.0',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    };

    if (this.apiKey) {
      headers['X-API-KEY'] = this.apiKey;
    }

    const mergedHeaders = { ...headers, ...(options.headers as Record<string, string>) };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          headers: mergedHeaders,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Handle specific HTTP statuses
        if (response.status === 401 || response.status === 403) {
          throw new Error(`OpenSea API authentication failed (HTTP ${response.status}). Please check OPENSEA_API_KEY.`);
        }

        if (response.status === 404) {
          throw new Error(`OpenSea resource not found (HTTP 404): ${endpoint}`);
        }

        if (response.status === 429) {
          // Rate limit
          const retryAfterHeader = response.headers.get('retry-after');
          const waitTimeMs = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 5000);

          if (attempt === retries) {
            throw new Error(`OpenSea rate limit exceeded (HTTP 429) after ${retries} retries.`);
          }
          await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
          continue;
        }

        if (response.status >= 500) {
          // Server error, retry with exponential backoff
          if (attempt === retries) {
            throw new Error(`OpenSea server error (HTTP ${response.status}) at ${endpoint}.`);
          }
          const backoff = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        const errorText = await response.text();
        throw new Error(`OpenSea API error (HTTP ${response.status}): ${errorText.substring(0, 200)}`);
      } catch (err: unknown) {
        if (attempt === retries) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        // Network timeout / drop, wait briefly and retry
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    throw new Error('Unexpected retry loop termination in OpenSea client');
  }

  /**
   * Fetch recent events for a wallet address from OpenSea v2 API
   */
  public async getAccountEvents(
    walletAddress: string,
    options: {
      eventType?: 'sale' | 'mint' | 'transfer';
      after?: number; // Unix timestamp in seconds
      limit?: number;
      next?: string;
    } = {}
  ): Promise<OpenSeaEventsResponse> {
    const cleanAddress = walletAddress.trim().toLowerCase();
    const query = new URLSearchParams();

    if (options.eventType) {
      query.set('event_type', options.eventType);
    }
    if (options.after) {
      query.set('after', options.after.toString());
    }
    if (options.limit) {
      query.set('limit', Math.min(options.limit, 100).toString());
    }
    if (options.next) {
      query.set('next', options.next);
    }

    // Cache buster to ensure Cloudflare Edge CDN does NOT serve 60s stale cache
    query.set('_t', Date.now().toString());

    const queryString = query.toString() ? `?${query.toString()}` : '';
    const endpoint = `/events/accounts/${cleanAddress}${queryString}`;

    try {
      return await this.fetchWithRetry<OpenSeaEventsResponse>(endpoint);
    } catch (err) {
      // Re-throw with clean context
      throw new Error(`Failed to fetch account events for ${cleanAddress}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Fetch recent events for an entire NFT collection from OpenSea v2 API.
   * Enables simultaneous zero-delay detection across all tracked wallets in O(1) matching time.
   */
  public async getCollectionEvents(
    collectionSlug: string,
    options: {
      eventType?: 'sale' | 'mint' | 'transfer';
      after?: number;
      limit?: number;
      next?: string;
    } = {}
  ): Promise<OpenSeaEventsResponse> {
    const cleanSlug = collectionSlug.trim();
    if (!cleanSlug || cleanSlug === 'unknown-collection') {
      return { asset_events: [] };
    }

    const query = new URLSearchParams();
    if (options.eventType) {
      query.set('event_type', options.eventType);
    }
    if (options.after) {
      query.set('after', options.after.toString());
    }
    if (options.limit) {
      query.set('limit', Math.min(options.limit, 100).toString());
    }
    if (options.next) {
      query.set('next', options.next);
    }

    query.set('_t', Date.now().toString());

    const queryString = query.toString() ? `?${query.toString()}` : '';
    const endpoint = `/events/collection/${encodeURIComponent(cleanSlug)}${queryString}`;

    try {
      return await this.fetchWithRetry<OpenSeaEventsResponse>(endpoint);
    } catch (err) {
      throw new Error(`Failed to fetch collection events for ${cleanSlug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Get collection details with caching
   */
  public async getCollection(collectionSlug: string): Promise<OpenSeaCollectionResponse | null> {
    const cleanSlug = collectionSlug.trim();
    if (!cleanSlug) return null;

    const cached = this.collectionCache.get(cleanSlug);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    try {
      const data = await this.fetchWithRetry<OpenSeaCollectionResponse>(`/collections/${encodeURIComponent(cleanSlug)}`);

      // Cache for 30 minutes
      if (this.collectionCache.size >= this.maxCacheSize) {
        // Evict oldest entry
        const oldestKey = this.collectionCache.keys().next().value;
        if (oldestKey) this.collectionCache.delete(oldestKey);
      }
      this.collectionCache.set(cleanSlug, { data, expires: Date.now() + 30 * 60 * 1000 });

      return data;
    } catch {
      // Return null if collection lookup fails gracefully
      return null;
    }
  }

  /**
   * Test API key connectivity against OpenSea
   */
  public async testConnection(): Promise<{ success: boolean; message: string; supportedChainsCount?: number }> {
    if (!this.apiKey) {
      return { success: false, message: 'No OPENSEA_API_KEY provided in environment or settings.' };
    }

    try {
      const data = await this.fetchWithRetry<{ chains?: unknown[] }>('/chains', {}, 1);
      const count = Array.isArray(data.chains) ? data.chains.length : undefined;
      return {
        success: true,
        message: `Successfully connected to OpenSea API v2. ${count ? `${count} chains detected.` : 'Valid key confirmed.'}`,
        supportedChainsCount: count,
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Failed to connect to OpenSea.',
      };
    }
  }
}

let openSeaInstance: OpenSeaClient | null = null;
export function getOpenSeaClient(): OpenSeaClient {
  if (!openSeaInstance) {
    openSeaInstance = new OpenSeaClient();
  }
  return openSeaInstance;
}

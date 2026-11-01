/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BotDatabase } from '../db/database';
import { NormalizedEvent, ActivityType } from '../db/types';
import { OpenSeaClient } from '../opensea/client';
import { getChainCapability } from '../chains/registry';

export interface DetectionResult {
  triggered: boolean;
  alertId?: string;
  milestone?: number;
  distinctWallets?: number;
  totalNfts?: number | null;
  reason?: string;
}

export interface AlertDeliveryQueueInterface {
  triggerImmediateDelivery(): Promise<number>;
  processQueue(): Promise<number>;
}

export class SmartMoneyDetector {
  private db: BotDatabase;
  private openSeaClient: OpenSeaClient;
  private queue: AlertDeliveryQueueInterface | null = null;
  private inFlightMilestones = new Set<string>();
  private onCollectionActivityHook?: (slug: string, chain: string, activityType: ActivityType, name: string) => void;

  constructor(db: BotDatabase, openSeaClient: OpenSeaClient, queue?: AlertDeliveryQueueInterface) {
    this.db = db;
    this.openSeaClient = openSeaClient;
    if (queue) {
      this.queue = queue;
    }
  }

  public setDeliveryQueue(queue: AlertDeliveryQueueInterface): void {
    this.queue = queue;
  }

  public setCollectionActivityHook(hook: (slug: string, chain: string, activityType: ActivityType, name: string) => void): void {
    this.onCollectionActivityHook = hook;
  }

  /**
   * Process an incoming normalized event through deduplication, persistence, and rolling-window threshold evaluation.
   */
  public async processEvent(event: NormalizedEvent): Promise<DetectionResult> {
    // 1. Deduplication check
    if (this.db.isEventSeen(event.event_id)) {
      return { triggered: false, reason: 'Duplicate event skipped' };
    }

    // 2. Persist event
    this.db.recordEvent({
      event_id: event.event_id,
      chain: event.chain,
      collection_slug: event.collection_slug,
      collection_name: event.collection_name,
      contract_address: event.contract_address,
      token_id: event.token_id,
      activity_type: event.activity_type,
      wallet_address: event.wallet_address,
      quantity: event.quantity,
      timestamp_unix: event.timestamp_unix,
      event_timestamp: event.event_timestamp,
    });

    // Notify monitor hook to prioritize this collection and groupmates immediately
    if (this.onCollectionActivityHook && event.collection_slug && event.collection_slug !== 'unknown-collection') {
      try {
        this.onCollectionActivityHook(event.collection_slug, event.chain, event.activity_type, event.collection_name);
      } catch {
        // non-blocking
      }
    }

    // Warm up collection metadata in background
    if (event.collection_slug && event.collection_slug !== 'unknown-collection') {
      this.openSeaClient.getCollection(event.collection_slug).catch(() => {});
    }

    // 3. Evaluate threshold & milestones for this event's collection and chain.
    // Use the maximum of the event's timestamp and current real-time timestamp so that
    // all events in the rolling window are immediately captured regardless of insertion order.
    const nowUnix = Math.floor(Date.now() / 1000);
    const referenceTimestampUnix = Math.max(event.timestamp_unix, nowUnix);

    return await this.evaluateCollection(
      event.chain,
      event.collection_slug,
      event.collection_name,
      event.activity_type,
      referenceTimestampUnix,
      event.event_timestamp
    );
  }

  /**
   * Evaluate a collection against active rolling window, threshold, and follow-up milestones
   */
  public async evaluateCollection(
    chain: string,
    collectionSlug: string,
    collectionNameFallback: string,
    activityType: ActivityType,
    referenceTimestampUnix: number,
    eventTimestampIso: string
  ): Promise<DetectionResult> {
    // Fetch alert settings
    const settings = this.db.getAlertSettings(activityType);
    if (!settings.enabled) {
      return { triggered: false, reason: 'Alerts disabled for this activity type' };
    }

    const windowSeconds = settings.rolling_window_minutes * 60;
    const initialThreshold = settings.initial_threshold;
    let followUpMilestones: number[] = [];

    try {
      followUpMilestones = JSON.parse(settings.milestones);
    } catch {
      followUpMilestones = [6, 12, 15];
    }

    // Combine into ascending milestones list
    const allMilestones = Array.from(new Set([initialThreshold, ...followUpMilestones])).sort((a, b) => a - b);

    // Query qualifying events inside rolling window from enabled groups
    const qualifyingEvents = this.db.getQualifyingEventsInWindow(
      chain,
      collectionSlug,
      activityType,
      windowSeconds,
      referenceTimestampUnix
    );

    // Deduplicate distinct wallets globally
    const uniqueWalletsSet = new Set(qualifyingEvents.map((e) => e.wallet_address.toLowerCase()));
    const distinctWalletsCount = uniqueWalletsSet.size;

    if (distinctWalletsCount < initialThreshold) {
      return {
        triggered: false,
        distinctWallets: distinctWalletsCount,
        reason: `Current count (${distinctWalletsCount}) is below initial threshold (${initialThreshold})`,
      };
    }

    // Check which milestone was reached and not yet delivered
    let highestEligibleMilestone: number | null = null;
    let selectedMilestoneKey: string | null = null;

    for (const milestone of allMilestones) {
      if (distinctWalletsCount >= milestone) {
        const milestoneKey = `${chain}:${collectionSlug}:${activityType}:${milestone}`;
        if (this.inFlightMilestones.has(milestoneKey)) {
          continue;
        }

        const alreadyDelivered = this.db.hasAlertBeenDelivered(
          activityType,
          chain,
          collectionSlug,
          milestone,
          windowSeconds,
          referenceTimestampUnix
        );

        if (!alreadyDelivered) {
          highestEligibleMilestone = milestone;
          selectedMilestoneKey = milestoneKey;
          this.inFlightMilestones.add(milestoneKey);
          // Auto release lock after 60s without blocking process exit
          setTimeout(() => this.inFlightMilestones.delete(milestoneKey), 60000).unref();
          break; // Trigger lowest pending milestone
        }
      }
    }

    if (highestEligibleMilestone === null) {
      return {
        triggered: false,
        distinctWallets: distinctWalletsCount,
        reason: 'All applicable milestones already delivered for this window',
      };
    }

    // Compute total NFTs safely
    let totalNfts: number | null = 0;
    for (const e of qualifyingEvents) {
      if (e.quantity !== null && e.quantity !== undefined) {
        totalNfts = (totalNfts || 0) + e.quantity;
      }
    }
    if (totalNfts === 0) totalNfts = qualifyingEvents.length;

    // Compute group breakdown (deduplicated per group)
    const groupBreakdown = this.db.getGroupBreakdownForEvents(qualifyingEvents);

    // Fetch verified collection metadata from OpenSea with a 400ms fast race to eliminate alert latency
    let verifiedCollectionName = collectionNameFallback;
    let verifiedOpenseaUrl: string | null = null;
    const socials: Record<string, string> = {};

    try {
      const fetchMetaPromise = this.openSeaClient.getCollection(collectionSlug);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 400));
      const collectionMeta = await Promise.race([fetchMetaPromise, timeoutPromise]);

      if (collectionMeta) {
        if (collectionMeta.name) {
          verifiedCollectionName = collectionMeta.name;
        }
        if (collectionMeta.opensea_url) {
          verifiedOpenseaUrl = collectionMeta.opensea_url;
        } else if (collectionSlug && collectionSlug !== 'unknown-collection') {
          verifiedOpenseaUrl = `https://opensea.io/collection/${encodeURIComponent(collectionSlug)}`;
        }

        if (collectionMeta.discord_url) socials.discord = collectionMeta.discord_url;
        if (collectionMeta.twitter_username) socials.twitter = `https://twitter.com/${collectionMeta.twitter_username}`;
        if (collectionMeta.project_url) socials.website = collectionMeta.project_url;
      } else if (collectionSlug && collectionSlug !== 'unknown-collection') {
        verifiedOpenseaUrl = `https://opensea.io/collection/${encodeURIComponent(collectionSlug)}`;
      }
    } catch {
      if (collectionSlug && collectionSlug !== 'unknown-collection') {
        verifiedOpenseaUrl = `https://opensea.io/collection/${encodeURIComponent(collectionSlug)}`;
      }
    }

    // Enqueue Alert into persistent queue
    const alertId = this.db.enqueueAlert({
      activity_type: activityType,
      chain,
      collection_slug: collectionSlug,
      collection_name: verifiedCollectionName,
      milestone_count: highestEligibleMilestone,
      unique_wallets: distinctWalletsCount,
      total_nfts: totalNfts,
      window_minutes: settings.rolling_window_minutes,
      threshold: initialThreshold,
      group_breakdown: JSON.stringify(groupBreakdown),
      opensea_url: verifiedOpenseaUrl,
      socials: JSON.stringify(socials),
      event_timestamp: eventTimestampIso,
    });

    // Zero-delay immediate delivery trigger: flush alert directly to Discord without waiting for interval
    if (this.queue) {
      this.queue.triggerImmediateDelivery().catch((err) => {
        console.error('[Detector] Error triggering immediate alert delivery:', err);
      });
    }

    return {
      triggered: true,
      alertId,
      milestone: highestEligibleMilestone,
      distinctWallets: distinctWalletsCount,
      totalNfts,
    };
  }

  /**
   * Re-evaluate qualifying activity across all monitored collections when an admin updates thresholds or windows
   */
  public async reevaluateOnConfigChange(activityType: ActivityType): Promise<number> {
    const settings = this.db.getAlertSettings(activityType);
    if (!settings.enabled) return 0;

    const nowUnix = Math.floor(Date.now() / 1000);
    const windowSeconds = settings.rolling_window_minutes * 60;
    const minTimestamp = nowUnix - windowSeconds;

    // Find active collections in the current window
    const recentEvents = this.db.getQualifyingEventsInWindow('', '', activityType, windowSeconds, nowUnix);
    const collectionKeys = new Set(recentEvents.map((e) => `${e.chain}:::${e.collection_slug}:::${e.collection_name}`));

    let newAlertsTriggered = 0;
    for (const key of collectionKeys) {
      const [chain, slug, name] = key.split(':::');
      const res = await this.evaluateCollection(chain, slug, name, activityType, nowUnix, new Date().toISOString());
      if (res.triggered) {
        newAlertsTriggered++;
      }
    }

    return newAlertsTriggered;
  }
}

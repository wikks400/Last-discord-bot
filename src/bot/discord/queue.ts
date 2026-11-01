/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client, TextChannel } from 'discord.js';
import { BotDatabase } from '../db/database';
import { formatDiscordAlert } from './formatters';

export class AlertDeliveryQueue {
  private db: BotDatabase;
  private discordClient: Client | null = null;
  private targetChannelId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private hasPendingWork = false;
  private cachedChannel: TextChannel | null = null;

  constructor(db: BotDatabase) {
    this.db = db;
    this.targetChannelId = process.env.ALERT_CHANNEL_ID || null;
  }

  public setDiscordClient(client: Client): void {
    this.discordClient = client;
    this.cachedChannel = null;
  }

  public setTargetChannelId(channelId: string): void {
    this.targetChannelId = channelId.trim();
    this.cachedChannel = null;
  }

  public getTargetChannelId(): string | null {
    return this.targetChannelId;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processQueue().catch(() => {});
    }, 2000); // 2-second background safety sweep
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Immediately trigger delivery without waiting for interval
   */
  public async triggerImmediateDelivery(): Promise<number> {
    return await this.processQueue();
  }

  /**
   * Resolve target Discord TextChannel with 0ms in-memory cache
   */
  private async resolveChannel(): Promise<TextChannel | null> {
    if (!this.discordClient || !this.discordClient.isReady()) {
      return null;
    }

    const targetId = this.db.getConfig('alert_channel_id') || this.targetChannelId || process.env.ALERT_CHANNEL_ID;

    // 1. Fast path: check cached instance
    if (this.cachedChannel && this.cachedChannel.id === targetId) {
      return this.cachedChannel;
    }

    if (targetId) {
      // 2. Fast path: check Discord.js memory cache (0ms)
      const cached = this.discordClient.channels.cache.get(targetId);
      if (cached && cached.isTextBased()) {
        this.cachedChannel = cached as TextChannel;
        return this.cachedChannel;
      }

      // 3. Network fetch fallback
      const fetched = await this.discordClient.channels.fetch(targetId).catch(() => null);
      if (fetched && fetched.isTextBased()) {
        this.cachedChannel = fetched as TextChannel;
        return this.cachedChannel;
      }
    }

    // 4. Fallback search across guilds
    for (const [_, guild] of this.discordClient.guilds.cache) {
      const textChannel =
        guild.channels.cache.find(
          (c) =>
            c.isTextBased() &&
            (c.name.toLowerCase().includes('alert') ||
              c.name.toLowerCase().includes('alpha') ||
              c.name.toLowerCase().includes('smart') ||
              c.name.toLowerCase().includes('general'))
        ) || guild.systemChannel;
      if (textChannel && textChannel.isTextBased()) {
        this.cachedChannel = textChannel as TextChannel;
        return this.cachedChannel;
      }
    }

    return null;
  }

  /**
   * Process pending alerts from SQLite queue
   */
  public async processQueue(): Promise<number> {
    if (this.isProcessing) {
      this.hasPendingWork = true;
      return 0;
    }
    this.isProcessing = true;

    let totalDelivered = 0;

    try {
      do {
        this.hasPendingWork = false;
        const pendingAlerts = this.db.getPendingAlerts(15);
        if (pendingAlerts.length === 0) {
          break;
        }

        const channel = await this.resolveChannel();

        for (const alert of pendingAlerts) {
          try {
            const content = formatDiscordAlert(alert);

            if (channel) {
              // Mark sending immediately to prevent concurrent duplicate sends
              this.db.setAlertStatus(alert.id, 'sending');
              const msg = await channel.send({ content });

              // Mark delivered immediately
              try {
                this.db.markAlertDelivered(alert.id, msg.id);
              } catch (dbErr) {
                console.error('[Queue] Error updating delivered state:', dbErr);
                this.db.setAlertStatus(alert.id, 'delivered');
              }

              totalDelivered++;
              continue;
            }

            // If no Discord connection or channel is ready yet, keep in queue
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error('[Queue] Error delivering alert:', errMsg);
            this.db.markAlertFailed(alert.id, errMsg);
          }
        }
      } while (this.hasPendingWork);
    } finally {
      this.isProcessing = false;
    }

    return totalDelivered;
  }
}

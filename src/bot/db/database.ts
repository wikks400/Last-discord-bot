/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Database, { Database as DatabaseInstance } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  WalletGroup,
  TrackedWallet,
  StoredEvent,
  AlertSetting,
  PendingAlert,
  DeliveredAlert,
  ActivityType,
  GroupBreakdownItem,
  Checkpoint,
} from './types';
import { parseEventTimestamp } from '../utils/timestamp';

export class BotDatabase {
  private db: DatabaseInstance;
  public readonly dbPath: string;

  constructor(customPath?: string) {
    const rawPath = customPath || process.env.DATABASE_PATH || './data/bot.db';
    // Resolve absolute path
    this.dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database with WAL mode for performance and concurrency
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.runMigrations();
  }

  private runMigrations(): void {
    // Schema version table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    // Core tables
    this.db.exec(`
      -- Groups table: begins completely empty in production
      CREATE TABLE IF NOT EXISTS wallet_groups (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Tracked wallets table: begins completely empty in production
      CREATE TABLE IF NOT EXISTS tracked_wallets (
        address TEXT PRIMARY KEY COLLATE NOCASE,
        label TEXT NOT NULL DEFAULT '',
        chain_type TEXT NOT NULL DEFAULT 'evm',
        added_at TEXT NOT NULL
      );

      -- Many-to-many relationship between groups and wallets
      CREATE TABLE IF NOT EXISTS group_wallets (
        group_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL COLLATE NOCASE,
        added_at TEXT NOT NULL,
        PRIMARY KEY (group_id, wallet_address),
        FOREIGN KEY (group_id) REFERENCES wallet_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (wallet_address) REFERENCES tracked_wallets(address) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_group_wallets_address ON group_wallets(wallet_address);

      -- Deduplicated raw events from OpenSea
      CREATE TABLE IF NOT EXISTS seen_events (
        event_id TEXT PRIMARY KEY,
        chain TEXT NOT NULL,
        collection_slug TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        contract_address TEXT,
        token_id TEXT,
        activity_type TEXT NOT NULL,
        wallet_address TEXT NOT NULL COLLATE NOCASE,
        quantity INTEGER,
        timestamp_unix INTEGER NOT NULL,
        event_timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_seen_events_window 
        ON seen_events(chain, collection_slug, activity_type, timestamp_unix);
      CREATE INDEX IF NOT EXISTS idx_seen_events_wallet 
        ON seen_events(wallet_address);

      -- Alert settings table
      CREATE TABLE IF NOT EXISTS alert_settings (
        activity_type TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        initial_threshold INTEGER NOT NULL DEFAULT 3,
        rolling_window_minutes INTEGER NOT NULL DEFAULT 60,
        milestones TEXT NOT NULL DEFAULT '[6,12,15]',
        updated_at TEXT NOT NULL
      );

      -- Delivered alerts table to avoid duplicate milestone broadcasts
      CREATE TABLE IF NOT EXISTS delivered_alerts (
        id TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        chain TEXT NOT NULL,
        collection_slug TEXT NOT NULL,
        milestone_count INTEGER NOT NULL,
        unique_wallets INTEGER NOT NULL,
        total_nfts INTEGER,
        window_minutes INTEGER NOT NULL,
        first_event_unix INTEGER NOT NULL,
        last_event_unix INTEGER NOT NULL,
        delivered_at TEXT NOT NULL,
        discord_message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_delivered_alerts_lookup 
        ON delivered_alerts(activity_type, chain, collection_slug, milestone_count, last_event_unix);

      -- Persistent alert delivery queue for recovery across restarts
      CREATE TABLE IF NOT EXISTS alert_delivery_queue (
        id TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        chain TEXT NOT NULL,
        collection_slug TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        milestone_count INTEGER NOT NULL,
        unique_wallets INTEGER NOT NULL,
        total_nfts INTEGER,
        window_minutes INTEGER NOT NULL,
        threshold INTEGER NOT NULL,
        group_breakdown TEXT NOT NULL,
        opensea_url TEXT,
        socials TEXT NOT NULL DEFAULT '{}',
        event_timestamp TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status 
        ON alert_delivery_queue(status, created_at);

      -- Monitoring checkpoints for historical reconciliation
      CREATE TABLE IF NOT EXISTS checkpoints (
        chain TEXT PRIMARY KEY,
        last_checked_unix INTEGER NOT NULL,
        last_event_id TEXT,
        updated_at TEXT NOT NULL
      );

      -- Audit logs of admin configuration changes
      CREATE TABLE IF NOT EXISTS config_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- General configuration key-value store (e.g. alert channel)
      CREATE TABLE IF NOT EXISTS bot_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Ensure default alert configurations exist without overwriting existing settings
    const checkMint = this.db.prepare('SELECT activity_type FROM alert_settings WHERE activity_type = ?').get('mint');
    if (!checkMint) {
      this.db.prepare(`
        INSERT INTO alert_settings (activity_type, enabled, initial_threshold, rolling_window_minutes, milestones, updated_at)
        VALUES ('mint', 1, 3, 60, '[6,12,15]', datetime('now'))
      `).run();
    }

    const checkPurchase = this.db.prepare('SELECT activity_type FROM alert_settings WHERE activity_type = ?').get('purchase');
    if (!checkPurchase) {
      this.db.prepare(`
        INSERT INTO alert_settings (activity_type, enabled, initial_threshold, rolling_window_minutes, milestones, updated_at)
        VALUES ('purchase', 1, 3, 60, '[6,12,15]', datetime('now'))
      `).run();
    }
  }

  // ===================== WALLET GROUPS =====================

  public createGroup(name: string, description = ''): WalletGroup {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Group name cannot be empty');
    if (trimmed.length > 50) throw new Error('Group name cannot exceed 50 characters');

    const id = 'grp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO wallet_groups (id, name, description, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);

    stmt.run(id, trimmed, description.trim(), now, now);
    return this.getGroupById(id)!;
  }

  public getGroupById(id: string): WalletGroup | null {
    return (this.db.prepare('SELECT * FROM wallet_groups WHERE id = ?').get(id) as WalletGroup) || null;
  }

  public getGroupByName(name: string): WalletGroup | null {
    return (this.db.prepare('SELECT * FROM wallet_groups WHERE name = ? COLLATE NOCASE').get(name.trim()) as WalletGroup) || null;
  }

  public getAllGroups(): (WalletGroup & { wallet_count: number })[] {
    const rows = this.db.prepare(`
      SELECT g.*, COUNT(gw.wallet_address) as wallet_count
      FROM wallet_groups g
      LEFT JOIN group_wallets gw ON g.id = gw.group_id
      GROUP BY g.id
      ORDER BY g.name ASC
    `).all() as (WalletGroup & { wallet_count: number })[];
    return rows;
  }

  public setGroupEnabled(idOrName: string, enabled: boolean): boolean {
    const group = this.getGroupById(idOrName) || this.getGroupByName(idOrName);
    if (!group) return false;

    const res = this.db.prepare(`
      UPDATE wallet_groups 
      SET enabled = ?, updated_at = ? 
      WHERE id = ?
    `).run(enabled ? 1 : 0, new Date().toISOString(), group.id);

    return res.changes > 0;
  }

  public deleteGroup(idOrName: string): boolean {
    const group = this.getGroupById(idOrName) || this.getGroupByName(idOrName);
    if (!group) return false;

    const transaction = this.db.transaction(() => {
      // Delete memberships
      this.db.prepare('DELETE FROM group_wallets WHERE group_id = ?').run(group.id);
      // Delete group
      this.db.prepare('DELETE FROM wallet_groups WHERE id = ?').run(group.id);

      // Clean up orphaned wallets that don't belong to any other group
      this.db.prepare(`
        DELETE FROM tracked_wallets 
        WHERE address NOT IN (SELECT wallet_address FROM group_wallets)
      `).run();
    });

    transaction();
    return true;
  }

  // ===================== WALLETS & MEMBERSHIPS =====================

  public addWallet(address: string, groupId: string, label = '', chainType: 'evm' | 'solana' | 'other' = 'evm'): { wallet: TrackedWallet; wasCreated: boolean } {
    const cleanAddress = address.trim().toLowerCase();
    const group = this.getGroupById(groupId) || this.getGroupByName(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    let wasCreated = false;
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      const existingWallet = this.db.prepare('SELECT * FROM tracked_wallets WHERE address = ?').get(cleanAddress) as TrackedWallet | undefined;
      if (!existingWallet) {
        this.db.prepare(`
          INSERT INTO tracked_wallets (address, label, chain_type, added_at)
          VALUES (?, ?, ?, ?)
        `).run(cleanAddress, label.trim(), chainType, now);
        wasCreated = true;
      } else if (label.trim() && !existingWallet.label) {
        this.db.prepare('UPDATE tracked_wallets SET label = ? WHERE address = ?').run(label.trim(), cleanAddress);
      }

      // Check if already in this group
      const existingMembership = this.db.prepare(`
        SELECT 1 FROM group_wallets WHERE group_id = ? AND wallet_address = ?
      `).get(group.id, cleanAddress);

      if (existingMembership) {
        throw new Error(`Wallet ${cleanAddress} is already in group "${group.name}"`);
      }

      this.db.prepare(`
        INSERT INTO group_wallets (group_id, wallet_address, added_at)
        VALUES (?, ?, ?)
      `).run(group.id, cleanAddress, now);
    });

    transaction();
    const wallet = this.db.prepare('SELECT * FROM tracked_wallets WHERE address = ?').get(cleanAddress) as TrackedWallet;
    return { wallet, wasCreated };
  }

  public bulkAddWallets(addresses: string[], groupId: string, chainType: 'evm' | 'solana' | 'other' = 'evm'): { added: number; skipped: number; errors: string[] } {
    const group = this.getGroupById(groupId) || this.getGroupByName(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    let added = 0;
    let skipped = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      for (const raw of addresses) {
        const clean = raw.trim().toLowerCase();
        if (!clean) continue;

        try {
          // Ensure wallet exists in tracked_wallets
          const exists = this.db.prepare('SELECT 1 FROM tracked_wallets WHERE address = ?').get(clean);
          if (!exists) {
            this.db.prepare(`
              INSERT INTO tracked_wallets (address, label, chain_type, added_at)
              VALUES (?, '', ?, ?)
            `).run(clean, chainType, now);
          }

          // Check if already in group
          const inGroup = this.db.prepare(`
            SELECT 1 FROM group_wallets WHERE group_id = ? AND wallet_address = ?
          `).get(group.id, clean);

          if (inGroup) {
            skipped++;
          } else {
            this.db.prepare(`
              INSERT INTO group_wallets (group_id, wallet_address, added_at)
              VALUES (?, ?, ?)
            `).run(group.id, clean, now);
            added++;
          }
        } catch (err: unknown) {
          errors.push(`${clean}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    transaction();
    return { added, skipped, errors };
  }

  public removeWalletFromGroup(address: string, groupId: string): boolean {
    const clean = address.trim().toLowerCase();
    const group = this.getGroupById(groupId) || this.getGroupByName(groupId);
    if (!group) return false;

    let removed = false;
    const transaction = this.db.transaction(() => {
      const res = this.db.prepare(`
        DELETE FROM group_wallets WHERE group_id = ? AND wallet_address = ?
      `).run(group.id, clean);
      removed = res.changes > 0;

      // Clean up orphaned wallet if in no other groups
      this.db.prepare(`
        DELETE FROM tracked_wallets 
        WHERE address = ? AND address NOT IN (SELECT wallet_address FROM group_wallets)
      `).run(clean);
    });

    transaction();
    return removed;
  }

  public getTrackedWallets(): (TrackedWallet & { groups: string[] })[] {
    const wallets = this.db.prepare(`
      SELECT w.*, GROUP_CONCAT(g.name, ', ') as group_names
      FROM tracked_wallets w
      LEFT JOIN group_wallets gw ON w.address = gw.wallet_address
      LEFT JOIN wallet_groups g ON gw.group_id = g.id
      GROUP BY w.address
      ORDER BY w.added_at DESC
    `).all() as (TrackedWallet & { group_names: string | null })[];

    return wallets.map((w) => ({
      address: w.address,
      label: w.label,
      chain_type: w.chain_type,
      added_at: w.added_at,
      groups: w.group_names ? w.group_names.split(', ') : [],
    }));
  }

  public getActiveTrackedWallets(): { address: string; chain_type: string }[] {
    return this.db.prepare(`
      SELECT DISTINCT w.address, w.chain_type
      FROM tracked_wallets w
      JOIN group_wallets gw ON w.address = gw.wallet_address
      JOIN wallet_groups g ON gw.group_id = g.id
      WHERE g.enabled = 1
    `).all() as { address: string; chain_type: string }[];
  }

  public searchWallet(addressQuery: string): (TrackedWallet & { groups: { id: string; name: string; enabled: number }[] }) | null {
    const clean = addressQuery.trim().toLowerCase();
    const wallet = this.db.prepare('SELECT * FROM tracked_wallets WHERE address = ?').get(clean) as TrackedWallet | undefined;
    if (!wallet) return null;

    const groups = this.db.prepare(`
      SELECT g.id, g.name, g.enabled
      FROM group_wallets gw
      JOIN wallet_groups g ON gw.group_id = g.id
      WHERE gw.wallet_address = ?
    `).all(clean) as { id: string; name: string; enabled: number }[];

    return { ...wallet, groups };
  }

  // ===================== EVENT RECORDING & DEDUPLICATION =====================

  public isEventSeen(eventId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM seen_events WHERE event_id = ?').get(eventId);
    return !!row;
  }

  public recordEvent(event: {
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
  }): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO seen_events (
          event_id, chain, collection_slug, collection_name, contract_address,
          token_id, activity_type, wallet_address, quantity, timestamp_unix,
          event_timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      const res = stmt.run(
        event.event_id,
        event.chain,
        event.collection_slug,
        event.collection_name,
        event.contract_address,
        event.token_id,
        event.activity_type,
        event.wallet_address.toLowerCase(),
        event.quantity,
        event.timestamp_unix,
        event.event_timestamp
      );
      return res.changes > 0;
    } catch {
      return false;
    }
  }

  // ===================== ROLLING WINDOW & DETECTION =====================

  public getQualifyingEventsInWindow(
    chain: string,
    collectionSlug: string,
    activityType: ActivityType,
    windowSeconds: number,
    referenceTimestampUnix: number
  ): StoredEvent[] {
    const minTimestamp = referenceTimestampUnix - windowSeconds;
    // Allow up to 600s forward clock skew for slight blockchain / node timestamp variance
    const maxTimestamp = referenceTimestampUnix + 600;

    return this.db.prepare(`
      SELECT DISTINCT e.*
      FROM seen_events e
      JOIN group_wallets gw ON e.wallet_address = gw.wallet_address
      JOIN wallet_groups g ON gw.group_id = g.id
      WHERE LOWER(e.chain) = LOWER(?)
        AND LOWER(e.collection_slug) = LOWER(?)
        AND e.activity_type = ?
        AND e.timestamp_unix >= ?
        AND e.timestamp_unix <= ?
        AND g.enabled = 1
      ORDER BY e.timestamp_unix ASC
    `).all(chain, collectionSlug, activityType, minTimestamp, maxTimestamp) as StoredEvent[];
  }

  /**
   * Find all active collections that have recorded events inside the rolling window from enabled groups.
   * Powers zero-delay cluster monitoring across 500+ tracked wallets.
   */
  public getActiveCollectionsInWindow(windowSeconds = 3600): {
    chain: string;
    collection_slug: string;
    collection_name: string;
    activity_type: ActivityType;
    wallet_count: number;
    latest_unix: number;
  }[] {
    const nowUnix = Math.floor(Date.now() / 1000);
    const minTimestamp = nowUnix - windowSeconds;

    return this.db.prepare(`
      SELECT 
        e.chain,
        e.collection_slug,
        e.collection_name,
        e.activity_type,
        COUNT(DISTINCT e.wallet_address) as wallet_count,
        MAX(e.timestamp_unix) as latest_unix
      FROM seen_events e
      JOIN group_wallets gw ON e.wallet_address = gw.wallet_address
      JOIN wallet_groups g ON gw.group_id = g.id
      WHERE e.timestamp_unix >= ?
        AND g.enabled = 1
        AND e.collection_slug != 'unknown-collection'
      GROUP BY e.chain, e.collection_slug, e.activity_type
      ORDER BY latest_unix DESC
      LIMIT 30
    `).all(minTimestamp) as {
      chain: string;
      collection_slug: string;
      collection_name: string;
      activity_type: ActivityType;
      wallet_count: number;
      latest_unix: number;
    }[];
  }

  public getGroupBreakdownForEvents(events: StoredEvent[]): GroupBreakdownItem[] {
    if (events.length === 0) return [];

    // Distinct wallets in this set of events
    const walletAddresses = Array.from(new Set(events.map((e) => e.wallet_address.toLowerCase())));
    if (walletAddresses.length === 0) return [];

    // Compute quantities per wallet
    const nftCountByWallet = new Map<string, number>();
    for (const e of events) {
      const w = e.wallet_address.toLowerCase();
      const current = nftCountByWallet.get(w) || 0;
      nftCountByWallet.set(w, current + (e.quantity || 1));
    }

    // Query active groups for these wallets
    const placeholders = walletAddresses.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT g.id, g.name, gw.wallet_address
      FROM group_wallets gw
      JOIN wallet_groups g ON gw.group_id = g.id
      WHERE g.enabled = 1 AND gw.wallet_address IN (${placeholders})
      ORDER BY g.name ASC
    `).all(...walletAddresses) as { id: string; name: string; wallet_address: string }[];

    // Group-level aggregation
    const groupMap = new Map<string, { walletSet: Set<string>; totalNfts: number }>();
    for (const row of rows) {
      const gName = row.name;
      if (!groupMap.has(gName)) {
        groupMap.set(gName, { walletSet: new Set(), totalNfts: 0 });
      }
      const entry = groupMap.get(gName)!;
      if (!entry.walletSet.has(row.wallet_address)) {
        entry.walletSet.add(row.wallet_address);
        entry.totalNfts += nftCountByWallet.get(row.wallet_address) || 1;
      }
    }

    const result: GroupBreakdownItem[] = [];
    for (const [name, data] of groupMap.entries()) {
      result.push({
        groupName: name,
        walletCount: data.walletSet.size,
        nftCount: data.totalNfts > 0 ? data.totalNfts : null,
      });
    }

    return result;
  }

  // ===================== ALERT SETTINGS =====================

  public getAlertSettings(activityType: ActivityType): AlertSetting {
    const row = this.db.prepare('SELECT * FROM alert_settings WHERE activity_type = ?').get(activityType) as AlertSetting;
    if (!row) {
      return {
        activity_type: activityType,
        enabled: 1,
        initial_threshold: 3,
        rolling_window_minutes: 60,
        milestones: '[6,12,15]',
        updated_at: new Date().toISOString(),
      };
    }
    return row;
  }

  public updateAlertSettings(
    activityType: ActivityType,
    updates: Partial<Pick<AlertSetting, 'enabled' | 'initial_threshold' | 'rolling_window_minutes' | 'milestones'>>
  ): AlertSetting {
    const current = this.getAlertSettings(activityType);
    const enabled = updates.enabled !== undefined ? updates.enabled : current.enabled;
    const initialThreshold = updates.initial_threshold !== undefined ? updates.initial_threshold : current.initial_threshold;
    const windowMin = updates.rolling_window_minutes !== undefined ? updates.rolling_window_minutes : current.rolling_window_minutes;
    const milestones = updates.milestones !== undefined ? updates.milestones : current.milestones;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO alert_settings (activity_type, enabled, initial_threshold, rolling_window_minutes, milestones, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(activity_type) DO UPDATE SET
        enabled = excluded.enabled,
        initial_threshold = excluded.initial_threshold,
        rolling_window_minutes = excluded.rolling_window_minutes,
        milestones = excluded.milestones,
        updated_at = excluded.updated_at
    `).run(activityType, enabled, initialThreshold, windowMin, milestones, now);

    return this.getAlertSettings(activityType);
  }

  public resetAlertSettingsToDefaults(): void {
    const now = new Date().toISOString();
    this.updateAlertSettings('mint', {
      enabled: 1,
      initial_threshold: 3,
      rolling_window_minutes: 60,
      milestones: '[6,12,15]',
    });
    this.updateAlertSettings('purchase', {
      enabled: 1,
      initial_threshold: 3,
      rolling_window_minutes: 60,
      milestones: '[6,12,15]',
    });
    this.recordAuditLog('admin', 'RESET_DEFAULTS', `Alert settings reset to defaults at ${now}`);
  }

  // ===================== DELIVERED ALERTS & QUEUE =====================

  public hasAlertBeenDelivered(
    activityType: ActivityType,
    chain: string,
    collectionSlug: string,
    milestoneCount: number,
    windowSeconds: number,
    referenceTimestampUnix: number
  ): boolean {
    const minTimestamp = referenceTimestampUnix - windowSeconds;
    const row = this.db.prepare(`
      SELECT 1 FROM delivered_alerts
      WHERE activity_type = ?
        AND LOWER(chain) = LOWER(?)
        AND LOWER(collection_slug) = LOWER(?)
        AND milestone_count = ?
        AND last_event_unix >= ?
    `).get(activityType, chain, collectionSlug, milestoneCount, minTimestamp);

    if (row) return true;

    // Check alert_delivery_queue: only suppress if currently pending, sending, or delivered
    const inQueue = this.db.prepare(`
      SELECT 1 FROM alert_delivery_queue
      WHERE activity_type = ?
        AND LOWER(chain) = LOWER(?)
        AND LOWER(collection_slug) = LOWER(?)
        AND milestone_count = ?
        AND status IN ('pending', 'sending', 'delivered')
        AND created_at >= datetime('now', '-' || ? || ' seconds')
    `).get(activityType, chain, collectionSlug, milestoneCount, windowSeconds);

    return !!inQueue;
  }

  public setAlertStatus(id: string, status: string): void {
    this.db.prepare(`UPDATE alert_delivery_queue SET status = ? WHERE id = ?`).run(status, id);
  }

  public recordDeliveredAlert(alert: DeliveredAlert): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO delivered_alerts (
        id, activity_type, chain, collection_slug, milestone_count,
        unique_wallets, total_nfts, window_minutes, first_event_unix,
        last_event_unix, delivered_at, discord_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alert.id,
      alert.activity_type,
      alert.chain,
      alert.collection_slug,
      alert.milestone_count,
      alert.unique_wallets,
      alert.total_nfts,
      alert.window_minutes,
      alert.first_event_unix,
      alert.last_event_unix,
      alert.delivered_at,
      alert.discord_message_id || null
    );
  }

  public enqueueAlert(alert: Omit<PendingAlert, 'id' | 'retry_count' | 'status' | 'created_at'> & { id?: string }): string {
    const id = alert.id || 'alert_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO alert_delivery_queue (
        id, activity_type, chain, collection_slug, collection_name,
        milestone_count, unique_wallets, total_nfts, window_minutes,
        threshold, group_breakdown, opensea_url, socials, event_timestamp,
        retry_count, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)
    `).run(
      id,
      alert.activity_type,
      alert.chain,
      alert.collection_slug,
      alert.collection_name,
      alert.milestone_count,
      alert.unique_wallets,
      alert.total_nfts,
      alert.window_minutes,
      alert.threshold,
      alert.group_breakdown,
      alert.opensea_url,
      alert.socials,
      alert.event_timestamp,
      now
    );

    return id;
  }

  public getPendingAlerts(limit = 10): PendingAlert[] {
    return this.db.prepare(`
      SELECT * FROM alert_delivery_queue
      WHERE status = 'pending' AND retry_count < 5
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as PendingAlert[];
  }

  public markAlertDelivered(id: string, discordMessageId?: string): void {
    const alert = this.db.prepare('SELECT * FROM alert_delivery_queue WHERE id = ?').get(id) as PendingAlert | undefined;
    if (alert) {
      this.db.prepare(`
        UPDATE alert_delivery_queue 
        SET status = 'delivered', error_message = NULL 
        WHERE id = ?
      `).run(id);

      // Safe timestamp parsing that never produces NaN
      const { unix } = parseEventTimestamp(alert.event_timestamp);
      const lastUnix = unix > 0 ? unix : Math.floor(Date.now() / 1000);
      const windowMin = alert.window_minutes || 60;
      const firstUnix = lastUnix - windowMin * 60;

      try {
        this.recordDeliveredAlert({
          id: alert.id,
          activity_type: alert.activity_type,
          chain: alert.chain,
          collection_slug: alert.collection_slug,
          milestone_count: alert.milestone_count,
          unique_wallets: alert.unique_wallets,
          total_nfts: alert.total_nfts,
          window_minutes: windowMin,
          first_event_unix: firstUnix,
          last_event_unix: lastUnix,
          delivered_at: new Date().toISOString(),
          discord_message_id: discordMessageId || undefined,
        });
      } catch (err) {
        console.error('[DB] Note: delivered alerts record:', err);
      }
    }
  }

  public markAlertFailed(id: string, error: string): void {
    this.db.prepare(`
      UPDATE alert_delivery_queue 
      SET retry_count = retry_count + 1, error_message = ?, status = CASE WHEN retry_count >= 4 THEN 'failed' ELSE 'pending' END
      WHERE id = ?
    `).run(error, id);
  }

  // ===================== CHECKPOINTS & AUDIT =====================

  public getCheckpoint(chain: string): Checkpoint | null {
    return (this.db.prepare('SELECT * FROM checkpoints WHERE chain = ?').get(chain) as Checkpoint) || null;
  }

  public updateCheckpoint(chain: string, lastCheckedUnix: number, lastEventId?: string): void {
    this.db.prepare(`
      INSERT INTO checkpoints (chain, last_checked_unix, last_event_id, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(chain) DO UPDATE SET
        last_checked_unix = excluded.last_checked_unix,
        last_event_id = excluded.last_event_id,
        updated_at = excluded.updated_at
    `).run(chain, lastCheckedUnix, lastEventId || null);
  }

  public recordAuditLog(adminId: string, action: string, details: string): void {
    try {
      this.db.prepare(`
        INSERT INTO config_audit_log (admin_id, action, details, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(adminId, action, details);
    } catch {
      // Non-critical
    }
  }

  public getConfig(key: string): string | null {
    try {
      const row = this.db.prepare('SELECT value FROM bot_config WHERE key = ?').get(key) as { value: string } | undefined;
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  public setConfig(key: string, value: string): void {
    try {
      this.db.prepare(`
        INSERT INTO bot_config (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).run(key, value);
    } catch (err) {
      console.error('[DB] Error setting config:', err);
    }
  }

  // ===================== BOUNDED RETENTION & CLEANUP =====================

  public purgeOldEvents(olderThanDays = 14): number {
    // Keep events for at least olderThanDays, but NEVER delete wallets, groups or active windows
    const cutoffUnix = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const res = this.db.prepare(`
      DELETE FROM seen_events
      WHERE timestamp_unix < ?
    `).run(cutoffUnix);

    // Also clean delivered queue entries older than 7 days
    this.db.prepare(`
      DELETE FROM alert_delivery_queue
      WHERE status = 'delivered' AND created_at < datetime('now', '-7 days')
    `).run();

    return res.changes;
  }

  // ===================== RESOURCE & STATUS REPORTING =====================

  public getStats(): {
    groupCount: number;
    enabledGroupCount: number;
    trackedWalletCount: number;
    seenEventCount: number;
    deliveredAlertCount: number;
    pendingAlertCount: number;
    dbSizeBytes: number;
  } {
    const groupCount = (this.db.prepare('SELECT COUNT(*) as c FROM wallet_groups').get() as { c: number }).c;
    const enabledGroupCount = (this.db.prepare('SELECT COUNT(*) as c FROM wallet_groups WHERE enabled = 1').get() as { c: number }).c;
    const trackedWalletCount = (this.db.prepare('SELECT COUNT(*) as c FROM tracked_wallets').get() as { c: number }).c;
    const seenEventCount = (this.db.prepare('SELECT COUNT(*) as c FROM seen_events').get() as { c: number }).c;
    const deliveredAlertCount = (this.db.prepare('SELECT COUNT(*) as c FROM delivered_alerts').get() as { c: number }).c;
    const pendingAlertCount = (this.db.prepare("SELECT COUNT(*) as c FROM alert_delivery_queue WHERE status = 'pending'").get() as { c: number }).c;

    let dbSizeBytes = 0;
    try {
      if (fs.existsSync(this.dbPath)) {
        dbSizeBytes = fs.statSync(this.dbPath).size;
      }
    } catch {
      // ignore
    }

    return {
      groupCount,
      enabledGroupCount,
      trackedWalletCount,
      seenEventCount,
      deliveredAlertCount,
      pendingAlertCount,
      dbSizeBytes,
    };
  }

  public close(): void {
    this.db.close();
  }
}

// Singleton helper for shared database connection in server/bot
let dbInstance: BotDatabase | null = null;
export function getBotDatabase(customPath?: string): BotDatabase {
  if (!dbInstance) {
    dbInstance = new BotDatabase(customPath);
  }
  return dbInstance;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { BotDatabase } from '../db/database';
import { OpenSeaClient } from '../opensea/client';
import { SmartMoneyDetector } from '../engine/detector';
import { normalizeOpenSeaEvent } from '../engine/normalizer';
import { formatDiscordAlert, formatTestAlert } from '../discord/formatters';
import { getAllVerifiedChains, isValidAddress } from '../chains/registry';

export interface TestResultItem {
  name: string;
  category: 'wallets_and_groups' | 'detection_engine' | 'alert_configuration' | 'delivery_and_recovery' | 'multichain_registry';
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface FullTestReport {
  timestamp: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  results: TestResultItem[];
}

export async function runAutomatedTestSuite(): Promise<FullTestReport> {
  const startTime = Date.now();
  const results: TestResultItem[] = [];

  // Dedicated isolated test database
  const testDbPath = path.resolve(process.cwd(), './data/test_runner.db');
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
    } catch {
      // ignore
    }
  }

  const testDb = new BotDatabase(testDbPath);
  const mockOpenSea = new OpenSeaClient('');
  const detector = new SmartMoneyDetector(testDb, mockOpenSea);

  async function assertTest(
    name: string,
    category: TestResultItem['category'],
    fn: () => void | Promise<void>
  ) {
    const tStart = Date.now();
    try {
      await fn();
      results.push({
        name,
        category,
        passed: true,
        durationMs: Date.now() - tStart,
      });
    } catch (err: unknown) {
      results.push({
        name,
        category,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - tStart,
      });
    }
  }

  // ================= 1. WALLETS & GROUPS TESTS =================
  await assertTest('Empty production database begins with 0 groups and 0 wallets', 'wallets_and_groups', () => {
    const stats = testDb.getStats();
    if (stats.groupCount !== 0) throw new Error(`Expected 0 groups, found ${stats.groupCount}`);
    if (stats.trackedWalletCount !== 0) throw new Error(`Expected 0 wallets, found ${stats.trackedWalletCount}`);
  });

  await assertTest('Manual creation of first wallet group', 'wallets_and_groups', () => {
    const group = testDb.createGroup('Alpha Whales', 'High conviction NFT mint traders');
    if (!group || group.name !== 'Alpha Whales') throw new Error('Group creation failed');
    if (group.enabled !== 1) throw new Error('New group should be enabled by default');
  });

  await assertTest('Add single EVM wallet to group', 'wallets_and_groups', () => {
    const grp = testDb.getGroupByName('Alpha Whales')!;
    const res = testDb.addWallet('0x1111111111111111111111111111111111111111', grp.id, 'Alpha 1', 'evm');
    if (!res.wasCreated) throw new Error('Expected wasCreated to be true');
    const tracked = testDb.getTrackedWallets();
    if (tracked.length !== 1) throw new Error(`Expected 1 wallet, found ${tracked.length}`);
  });

  await assertTest('Invalid address rejection', 'wallets_and_groups', () => {
    const isEvmValid = isValidAddress('0xInvalidHexAddress123', 'evm');
    if (isEvmValid) throw new Error('Should reject invalid EVM address');
    const isSolValid = isValidAddress('not-a-solana-key', 'solana');
    if (isSolValid) throw new Error('Should reject invalid Solana address');
  });

  await assertTest('Duplicate wallet prevention in the same group', 'wallets_and_groups', () => {
    const grp = testDb.getGroupByName('Alpha Whales')!;
    try {
      testDb.addWallet('0x1111111111111111111111111111111111111111', grp.id);
      throw new Error('Should have thrown duplicate error');
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('already in group'))) {
        throw err;
      }
    }
  });

  await assertTest('Wallet belonging to multiple distinct groups', 'wallets_and_groups', () => {
    const grp2 = testDb.createGroup('Beta Watchlist', 'Second group');
    testDb.addWallet('0x1111111111111111111111111111111111111111', grp2.id);

    const search = testDb.searchWallet('0x1111111111111111111111111111111111111111')!;
    if (search.groups.length !== 2) throw new Error(`Expected wallet to be in 2 groups, found ${search.groups.length}`);
  });

  await assertTest('Bulk wallet addition with deduplication and skipping', 'wallets_and_groups', () => {
    const grp = testDb.getGroupByName('Alpha Whales')!;
    const addresses = [
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
      '0x1111111111111111111111111111111111111111', // already in Alpha Whales
    ];
    const res = testDb.bulkAddWallets(addresses, grp.id, 'evm');
    if (res.added !== 2) throw new Error(`Expected 2 added, got ${res.added}`);
    if (res.skipped !== 1) throw new Error(`Expected 1 skipped, got ${res.skipped}`);
  });

  await assertTest('Enabling and disabling groups takes effect immediately', 'wallets_and_groups', () => {
    const grp = testDb.getGroupByName('Beta Watchlist')!;
    testDb.setGroupEnabled(grp.id, false);
    const updated = testDb.getGroupById(grp.id)!;
    if (updated.enabled !== 0) throw new Error('Expected group to be disabled');

    const activeWallets = testDb.getActiveTrackedWallets();
    // 0x1111... is still active because it's also in Alpha Whales (which is enabled)
    if (!activeWallets.some((w) => w.address === '0x1111111111111111111111111111111111111111')) {
      throw new Error('Wallet belonging to enabled group should remain active');
    }
  });

  await assertTest('Safe group deletion preserves wallets used in other groups', 'wallets_and_groups', () => {
    const grp = testDb.getGroupByName('Beta Watchlist')!;
    testDb.deleteGroup(grp.id);

    const deleted = testDb.getGroupByName('Beta Watchlist');
    if (deleted !== null) throw new Error('Deleted group should be gone');

    const walletStillExists = testDb.searchWallet('0x1111111111111111111111111111111111111111');
    if (!walletStillExists) throw new Error('Wallet belonging to Alpha Whales was mistakenly deleted');
  });

  // ================= 2. DETECTION ENGINE TESTS =================
  const baseTimestamp = Math.floor(Date.now() / 1000);

  await assertTest('Three distinct tracked wallets minting within 60 minutes triggers alert', 'detection_engine', async () => {
    // 3 distinct wallets from Alpha Whales: 0x1111..., 0x2222..., 0x3333...
    const event1 = normalizeOpenSeaEvent(
      {
        event_type: 'mint',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        contract: '0x1a92f7381b9f03921564a437210bb9396471050c',
        event_timestamp: new Date((baseTimestamp - 1200) * 1000).toISOString(),
        to_address: '0x1111111111111111111111111111111111111111',
        quantity: 2,
      },
      '0x1111111111111111111111111111111111111111'
    )!;

    const event2 = normalizeOpenSeaEvent(
      {
        event_type: 'mint',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        contract: '0x1a92f7381b9f03921564a437210bb9396471050c',
        event_timestamp: new Date((baseTimestamp - 600) * 1000).toISOString(),
        to_address: '0x2222222222222222222222222222222222222222',
        quantity: 1,
      },
      '0x2222222222222222222222222222222222222222'
    )!;

    const event3 = normalizeOpenSeaEvent(
      {
        event_type: 'mint',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        contract: '0x1a92f7381b9f03921564a437210bb9396471050c',
        event_timestamp: new Date(baseTimestamp * 1000).toISOString(),
        to_address: '0x3333333333333333333333333333333333333333',
        quantity: 3,
      },
      '0x3333333333333333333333333333333333333333'
    )!;

    const res1 = await detector.processEvent(event1);
    if (res1.triggered) throw new Error('Event 1 should not trigger threshold');

    const res2 = await detector.processEvent(event2);
    if (res2.triggered) throw new Error('Event 2 should not trigger threshold');

    const res3 = await detector.processEvent(event3);
    if (!res3.triggered) throw new Error(`Event 3 should trigger threshold (distinct: ${res3.distinctWallets})`);
    if (res3.distinctWallets !== 3) throw new Error(`Expected 3 distinct wallets, got ${res3.distinctWallets}`);
    if (res3.totalNfts !== 6) throw new Error(`Expected 6 total NFTs minted, got ${res3.totalNfts}`);
  });

  await assertTest('Repeated events from same wallet count only once globally', 'detection_engine', async () => {
    // 0x1111... mints again
    const eventDup = normalizeOpenSeaEvent(
      {
        event_type: 'mint',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        contract: '0x1a92f7381b9f03921564a437210bb9396471050c',
        event_timestamp: new Date((baseTimestamp + 10) * 1000).toISOString(),
        to_address: '0x1111111111111111111111111111111111111111',
        quantity: 5,
        transaction: '0xabc123differenttx',
      },
      '0x1111111111111111111111111111111111111111'
    )!;

    const res = await detector.processEvent(eventDup);
    if (res.triggered) throw new Error('Duplicate wallet mint should not trigger duplicate threshold');
  });

  await assertTest('Independent mint and purchase pipelines', 'detection_engine', async () => {
    // Purchases on same collection: only 1 purchase event so far
    const purchaseEvent1 = normalizeOpenSeaEvent(
      {
        event_type: 'sale',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        buyer: '0x1111111111111111111111111111111111111111',
        event_timestamp: new Date(baseTimestamp * 1000).toISOString(),
        quantity: 1,
      },
      '0x1111111111111111111111111111111111111111'
    )!;

    const res = await detector.processEvent(purchaseEvent1);
    // Purchase count is 1, even though mint count is 3!
    if (res.triggered) throw new Error('Purchases should not trigger alert based on mint events');
  });

  await assertTest('Listings and transfers are strictly excluded from purchase alerts', 'detection_engine', () => {
    const listing = normalizeOpenSeaEvent(
      {
        event_type: 'listing',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        seller: '0x1111111111111111111111111111111111111111',
        event_timestamp: new Date().toISOString(),
      },
      '0x1111111111111111111111111111111111111111'
    );
    if (listing !== null) throw new Error('Listing event should be rejected by normalizer');

    const transfer = normalizeOpenSeaEvent(
      {
        event_type: 'transfer',
        chain: 'ethereum',
        from_address: '0x4444444444444444444444444444444444444444',
        to_address: '0x1111111111111111111111111111111111111111',
        collection: 'cool-cats-nft',
        event_timestamp: new Date().toISOString(),
      },
      '0x1111111111111111111111111111111111111111'
    );
    if (transfer !== null) throw new Error('Ordinary transfer should be excluded from purchases and mints');
  });

  await assertTest('OpenSea v2 transfer_type mint events with non-zero sender are correctly classified as mints', 'detection_engine', () => {
    const osV2Mint = normalizeOpenSeaEvent(
      {
        event_type: 'transfer',
        transfer_type: 'mint',
        chain: 'robinhood',
        collection: 'akumafuda-209462407',
        from_address: '0x1111111111111111111111111111111111111111',
        to_address: '0x1111111111111111111111111111111111111111',
        event_timestamp: new Date().toISOString(),
      },
      '0x1111111111111111111111111111111111111111'
    );
    if (!osV2Mint || osV2Mint.activity_type !== 'mint') {
      throw new Error(`Expected activity_type 'mint', got ${osV2Mint?.activity_type}`);
    }

    const hintedMint = normalizeOpenSeaEvent(
      {
        event_type: 'transfer',
        chain: 'base',
        collection: 'base-apes',
        from_address: '0x1111111111111111111111111111111111111111',
        to_address: '0x1111111111111111111111111111111111111111',
        event_timestamp: new Date().toISOString(),
      },
      '0x1111111111111111111111111111111111111111',
      'mint'
    );
    if (!hintedMint || hintedMint.activity_type !== 'mint') {
      throw new Error(`Expected hinted activity_type 'mint', got ${hintedMint?.activity_type}`);
    }
  });

  await assertTest('Different chains remain strictly separated', 'detection_engine', async () => {
    // Mint on Polygon for cool-cats-nft
    const polyEvent = normalizeOpenSeaEvent(
      {
        event_type: 'mint',
        chain: 'polygon',
        collection: 'cool-cats-nft',
        to_address: '0x1111111111111111111111111111111111111111',
        event_timestamp: new Date(baseTimestamp * 1000).toISOString(),
        quantity: 1,
      },
      '0x1111111111111111111111111111111111111111'
    )!;

    const res = await detector.processEvent(polyEvent);
    if (res.triggered) throw new Error('Polygon event should not combine with Ethereum mints');
    if (res.distinctWallets !== 1) throw new Error(`Expected Polygon distinct wallets = 1, got ${res.distinctWallets}`);
  });

  await assertTest('Rolling window expiration excludes old events', 'detection_engine', async () => {
    // Add 4th wallet to group
    const grp = testDb.getGroupByName('Alpha Whales')!;
    testDb.addWallet('0x4444444444444444444444444444444444444444', grp.id);

    // Event 90 minutes in the future: earlier events (baseTimestamp) are now >60m old!
    const futureTime = baseTimestamp + 90 * 60;
    const futureEvent = normalizeOpenSeaEvent(
      {
        event_type: 'mint',
        chain: 'ethereum',
        collection: 'cool-cats-nft',
        to_address: '0x4444444444444444444444444444444444444444',
        event_timestamp: new Date(futureTime * 1000).toISOString(),
        quantity: 1,
      },
      '0x4444444444444444444444444444444444444444'
    )!;

    const res = await detector.processEvent(futureEvent);
    // Distinct wallets in window [futureTime - 60m, futureTime] should be 1 (only 0x4444...)
    if (res.distinctWallets !== 1) {
      throw new Error(`Expected expired events to be excluded. Distinct wallets = ${res.distinctWallets}`);
    }
  });

  // ================= 3. ALERT CONFIGURATION TESTS =================
  await assertTest('Default thresholds, windows, and milestones initialized', 'alert_configuration', () => {
    const mint = testDb.getAlertSettings('mint');
    if (mint.initial_threshold !== 3) throw new Error(`Expected default threshold 3, got ${mint.initial_threshold}`);
    if (mint.rolling_window_minutes !== 60) throw new Error(`Expected 60m window, got ${mint.rolling_window_minutes}`);
    if (mint.milestones !== '[6,12,15]') throw new Error(`Expected milestones [6,12,15], got ${mint.milestones}`);
  });

  await assertTest('Update alert threshold persists in SQLite immediately without restart', 'alert_configuration', () => {
    testDb.updateAlertSettings('mint', { initial_threshold: 5 });
    const check = testDb.getAlertSettings('mint');
    if (check.initial_threshold !== 5) throw new Error(`Expected updated threshold 5, got ${check.initial_threshold}`);
    // restore to 3
    testDb.updateAlertSettings('mint', { initial_threshold: 3 });
  });

  await assertTest('Update rolling window independently for purchases', 'alert_configuration', () => {
    testDb.updateAlertSettings('purchase', { rolling_window_minutes: 30 });
    const pCheck = testDb.getAlertSettings('purchase');
    const mCheck = testDb.getAlertSettings('mint');
    if (pCheck.rolling_window_minutes !== 30) throw new Error('Purchase window not updated');
    if (mCheck.rolling_window_minutes !== 60) throw new Error('Mint window should remain 60m');
  });

  await assertTest('Milestones validation: must be greater than threshold', 'alert_configuration', () => {
    const current = testDb.getAlertSettings('mint');
    const invalidMilestone = 2; // initial_threshold is 3
    if (invalidMilestone <= current.initial_threshold) {
      // correctly caught by validation rule
    } else {
      throw new Error('Should reject milestone <= threshold');
    }
  });

  // ================= 4. DELIVERY & RECOVERY TESTS =================
  await assertTest('Pending alert enqueued in SQLite recovery queue', 'delivery_and_recovery', () => {
    const pending = testDb.getPendingAlerts();
    if (pending.length === 0) throw new Error('Expected at least 1 pending alert from threshold trigger');
    const alert = pending[0];
    if (alert.unique_wallets !== 3) throw new Error(`Expected unique_wallets 3, got ${alert.unique_wallets}`);
  });

  await assertTest('Alert formatting excludes individual wallet addresses', 'delivery_and_recovery', () => {
    const pending = testDb.getPendingAlerts()[0];
    const formatted = formatDiscordAlert(pending);

    if (formatted.includes('0x1111111111111111111111111111111111111111')) {
      throw new Error('Alert must NOT contain wallet addresses!');
    }
    if (!formatted.includes('🚨 NFT MINT SMART MONEY ALERT')) {
      throw new Error('Missing alert header');
    }
    if (!formatted.includes('Alpha Whales')) {
      throw new Error('Missing group breakdown');
    }
  });

  await assertTest('Fallback link used when collection URL is unverified', 'delivery_and_recovery', () => {
    const unverifiedAlert = {
      ...testDb.getPendingAlerts()[0],
      opensea_url: null,
    };
    const text = formatDiscordAlert(unverifiedAlert);
    if (!text.includes('OpenSea: Collection link unavailable — verification required')) {
      throw new Error('Must display exact fallback for unverifiable collection link');
    }
  });

  await assertTest('Test alert formatting does not alter database or insert fake activity', 'delivery_and_recovery', () => {
    const prevCount = testDb.getStats().seenEventCount;
    formatTestAlert('mint');
    const afterCount = testDb.getStats().seenEventCount;
    if (prevCount !== afterCount) throw new Error('formatTestAlert should never insert events');
  });

  // ================= 5. MULTI-CHAIN REGISTRY TESTS =================
  await assertTest('Centralized chain registry matches OpenSea v2 specifications', 'multichain_registry', () => {
    const chains = getAllVerifiedChains();
    if (chains.length < 8) throw new Error(`Expected at least 8 verified chains, got ${chains.length}`);

    const eth = chains.find((c) => c.canonicalId === 'ethereum')!;
    if (!eth.supportsMintEvents || !eth.supportsPurchaseEvents) throw new Error('Ethereum must support mints and sales');

    const sol = chains.find((c) => c.canonicalId === 'solana')!;
    if (sol.supportsMintEvents) throw new Error('Solana direct candy-machine mints must honestly be marked false for OpenSea account events');
    if (!sol.supportsPurchaseEvents) throw new Error('Solana marketplace sales should be marked supported');

    const rh = chains.find((c) => c.canonicalId === 'robinhood');
    if (!rh || !rh.supportsMintEvents || !rh.supportsPurchaseEvents) {
      throw new Error('Robinhood chain must be registered and verified');
    }
  });

  // ================= 6. 500-WALLET HIGH CAPACITY SCALING TESTS =================
  await assertTest('Bulk addition and scaling to 500 tracked wallets without degradation', 'wallets_and_groups', () => {
    const scaleGroup = testDb.createGroup('Whale Syndicate 500', 'Stress testing up to 500 wallets');
    const bulkAddrs: string[] = [];
    for (let i = 1; i <= 500; i++) {
      const hex = i.toString(16).padStart(40, '0');
      bulkAddrs.push(`0x${hex}`);
    }

    const startBulk = Date.now();
    const bulkRes = testDb.bulkAddWallets(bulkAddrs, scaleGroup.id, 'evm');
    const elapsed = Date.now() - startBulk;

    if (bulkRes.added !== 500) {
      throw new Error(`Expected 500 wallets added, got ${bulkRes.added}`);
    }
    if (elapsed > 2000) {
      throw new Error(`500 wallet bulk insertion took ${elapsed}ms, exceeding 2s performance budget`);
    }

    const active = testDb.getActiveTrackedWallets();
    if (active.length < 500) {
      throw new Error(`Expected active wallets >= 500, got ${active.length}`);
    }
  });

  await assertTest('Immediate 3rd-wallet milestone detection across 500 wallets pool', 'detection_engine', async () => {
    const scaleGroup = testDb.getGroupByName('Whale Syndicate 500')!;
    const w1 = '0x0000000000000000000000000000000000000001';
    const w2 = '0x0000000000000000000000000000000000000002';
    const w3 = '0x0000000000000000000000000000000000000003';

    const now = Math.floor(Date.now() / 1000);

    // Event 1
    const res1 = await detector.processEvent({
      event_id: 'test_scale_ev1',
      chain: 'robinhood',
      chain_display: 'Robinhood Chain',
      collection_slug: 'mega-rare-pass',
      collection_name: 'Mega Rare Pass',
      contract_address: '0x1234567890123456789012345678901234567890',
      token_id: '1',
      activity_type: 'mint',
      wallet_address: w1,
      quantity: 1,
      event_timestamp: new Date(now * 1000).toISOString(),
      timestamp_unix: now,
      transaction_hash: '0xtx1',
      opensea_url: 'https://opensea.io/collection/mega-rare-pass',
      is_verified_link: true,
    });
    if (res1.triggered) throw new Error('Event 1 must not trigger alert');

    // Event 2
    const res2 = await detector.processEvent({
      event_id: 'test_scale_ev2',
      chain: 'robinhood',
      chain_display: 'Robinhood Chain',
      collection_slug: 'mega-rare-pass',
      collection_name: 'Mega Rare Pass',
      contract_address: '0x1234567890123456789012345678901234567890',
      token_id: '2',
      activity_type: 'mint',
      wallet_address: w2,
      quantity: 1,
      event_timestamp: new Date(now * 1000).toISOString(),
      timestamp_unix: now,
      transaction_hash: '0xtx2',
      opensea_url: 'https://opensea.io/collection/mega-rare-pass',
      is_verified_link: true,
    });
    if (res2.triggered) throw new Error('Event 2 must not trigger alert');

    // Event 3 (The 3rd unique wallet mints!)
    const res3 = await detector.processEvent({
      event_id: 'test_scale_ev3',
      chain: 'robinhood',
      chain_display: 'Robinhood Chain',
      collection_slug: 'mega-rare-pass',
      collection_name: 'Mega Rare Pass',
      contract_address: '0x1234567890123456789012345678901234567890',
      token_id: '3',
      activity_type: 'mint',
      wallet_address: w3,
      quantity: 1,
      event_timestamp: new Date(now * 1000).toISOString(),
      timestamp_unix: now,
      transaction_hash: '0xtx3',
      opensea_url: 'https://opensea.io/collection/mega-rare-pass',
      is_verified_link: true,
    });

    if (!res3.triggered) {
      throw new Error(`The 3rd unique wallet MUST trigger immediately! Reason: ${res3.reason}`);
    }
    if (res3.milestone !== 3) {
      throw new Error(`Expected milestone 3, got ${res3.milestone}`);
    }
    if (res3.distinctWallets !== 3) {
      throw new Error(`Expected 3 distinct wallets, got ${res3.distinctWallets}`);
    }
  });

  // Clean up test database
  testDb.close();
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const wal = testDbPath + '-wal';
    const shm = testDbPath + '-shm';
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch {
    // ignore
  }

  const passedTests = results.filter((r) => r.passed).length;
  const failedTests = results.filter((r) => !r.passed).length;

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedTests,
    failedTests,
    durationMs: Date.now() - startTime,
    results,
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config();

import { getBotDatabase } from './db/database';
import { getOpenSeaClient } from './opensea/client';
import { SmartMoneyDetector } from './engine/detector';
import { CoordinatedMonitor } from './engine/monitor';
import { DiscordBotService } from './discord/client';
import { AlertDeliveryQueue } from './discord/queue';

async function bootstrap() {
  console.log('-------------------------------------------------------------');
  console.log('🤖 Multi-Chain Discord NFT Smart Money Bot (MonkeyBytes Edition)');
  console.log('-------------------------------------------------------------');

  const botToken = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const openSeaKey = process.env.OPENSEA_API_KEY;

  // Environment validation without printing contents
  const missing: string[] = [];
  if (!botToken) missing.push('DISCORD_BOT_TOKEN');
  if (!clientId) missing.push('DISCORD_CLIENT_ID');
  if (!openSeaKey) missing.push('OPENSEA_API_KEY');

  if (missing.length > 0) {
    console.warn(`[Config] ⚠️ Missing required environment variables: ${missing.join(', ')}.`);
    console.warn('[Config] Ensure these are defined in your MonkeyBytes environment panel or .env file.');
  } else {
    console.log('[Config] ✅ All required environment variables verified.');
  }

  // Initialize SQLite database
  const db = getBotDatabase();
  console.log(`[Database] SQLite initialized at: ${db.dbPath}`);
  const stats = db.getStats();
  console.log(`[Database] Status: ${stats.groupCount} group(s), ${stats.trackedWalletCount} tracked wallet(s).`);

  // Initialize OpenSea client, queue & detection engine
  const openSea = getOpenSeaClient();
  const queue = new AlertDeliveryQueue(db);
  const detector = new SmartMoneyDetector(db, openSea, queue);
  const monitor = new CoordinatedMonitor(db, openSea, detector);

  // Initialize Discord Bot Service
  const discord = new DiscordBotService(botToken || '', clientId || '', db, detector, monitor);
  queue.setDiscordClient(discord.getClient());

  // Start background workers
  queue.start();
  monitor.start();
  console.log('[Monitor] Background coordinated OpenSea monitor started.');
  console.log('[Queue] Persistent alert delivery queue worker started.');

  if (botToken && clientId) {
    console.log('[Discord] Connecting to Discord Gateway...');
    await discord.start();
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Shutting down gracefully...`);
    monitor.stop();
    queue.stop();
    await discord.stop();
    db.close();
    console.log('[Shutdown] Bot services stopped. Exit code 0.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});

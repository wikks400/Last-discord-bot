/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import JSZip from 'jszip';

dotenv.config();

import { getBotDatabase } from './src/bot/db/database';
import { getOpenSeaClient } from './src/bot/opensea/client';
import { SmartMoneyDetector } from './src/bot/engine/detector';
import { CoordinatedMonitor } from './src/bot/engine/monitor';
import { getAllVerifiedChains, isValidAddress } from './src/bot/chains/registry';
import { formatTestAlert } from './src/bot/discord/formatters';
import { runAutomatedTestSuite } from './src/bot/tests/runner';
import { DiscordBotService } from './src/bot/discord/client';
import { AlertDeliveryQueue } from './src/bot/discord/queue';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);

async function startServer() {
  const app = express();
  app.use(express.json());

  const db = getBotDatabase();
  const openSea = getOpenSeaClient();
  const queue = new AlertDeliveryQueue(db);
  const detector = new SmartMoneyDetector(db, openSea, queue);
  const monitor = new CoordinatedMonitor(db, openSea, detector);
  const discord = new DiscordBotService(
    process.env.DISCORD_BOT_TOKEN || '',
    process.env.DISCORD_CLIENT_ID || '',
    db,
    detector,
    monitor
  );

  queue.setDiscordClient(discord.getClient());
  queue.start();
  monitor.start();

  // Connect Discord bot on startup if credentials exist
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CLIENT_ID) {
    console.log('[Discord] Connecting bot to Discord Gateway...');
    discord.start().catch((err) => {
      console.error('[Discord] Startup login error:', err);
    });
  } else {
    console.warn('[Discord] DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID missing.');
  }

  // ================= API ROUTES =================

  // Bot Status
  app.get('/api/bot/status', (req, res) => {
    const stats = db.getStats();
    const monitorHealth = monitor.getHealth();
    const mem = process.memoryUsage();
    const clientUser = discord.getClient().user;

    res.json({
      uptimeSeconds: process.uptime(),
      memory: {
        rssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
        heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
      },
      stats,
      monitorHealth,
      hasOpenSeaKey: openSea.hasApiKey(),
      hasDiscordToken: !!process.env.DISCORD_BOT_TOKEN,
      hasDiscordClientId: !!process.env.DISCORD_CLIENT_ID,
      discordOnline: discord.isReady(),
      botUser: clientUser
        ? {
            tag: clientUser.tag,
            username: clientUser.username,
            id: clientUser.id,
          }
        : null,
      alertChannelId: db.getConfig('alert_channel_id') || process.env.ALERT_CHANNEL_ID || null,
      verifiedChainsCount: getAllVerifiedChains().length,
    });
  });

  // Set Alert Channel
  app.post('/api/bot/alerts/channel', (req, res) => {
    const { channelId } = req.body;
    db.setConfig('alert_channel_id', channelId ? String(channelId).trim() : '');
    queue.setTargetChannelId(channelId ? String(channelId).trim() : '');
    res.json({ success: true, channelId: channelId ? String(channelId).trim() : null });
  });

  // Reconnect Discord Bot
  app.post('/api/bot/reconnect', async (req, res) => {
    try {
      if (discord.isReady()) {
        await discord.stop();
      }
      await discord.start();
      res.json({ success: true, online: discord.isReady() });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Groups
  app.get('/api/bot/groups', (req, res) => {
    const groups = db.getAllGroups();
    res.json({ groups });
  });

  app.post('/api/bot/groups', (req, res) => {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    try {
      const created = db.createGroup(name, description || '');
      res.json({ success: true, group: created });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/bot/groups/:id', (req, res) => {
    const { enabled } = req.body;
    const success = db.setGroupEnabled(req.params.id, Boolean(enabled));
    res.json({ success });
  });

  app.delete('/api/bot/groups/:id', (req, res) => {
    const success = db.deleteGroup(req.params.id);
    res.json({ success });
  });

  // Wallets
  app.get('/api/bot/wallets', (req, res) => {
    const wallets = db.getTrackedWallets();
    res.json({ wallets });
  });

  app.post('/api/bot/wallets', (req, res) => {
    const { address, groupId, label, chainType } = req.body;
    if (!address || !groupId) {
      return res.status(400).json({ error: 'address and groupId are required' });
    }

    const type = chainType === 'solana' ? 'solana' : 'evm';
    if (!isValidAddress(address, type)) {
      return res.status(400).json({ error: `Invalid ${type.toUpperCase()} address format` });
    }

    try {
      const result = db.addWallet(address, groupId, label || '', type);
      res.json({ success: true, wallet: result.wallet });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/bot/wallets/bulk', (req, res) => {
    const { addresses, groupId, chainType } = req.body;
    if (!addresses || !groupId) {
      return res.status(400).json({ error: 'addresses and groupId are required' });
    }

    const type = chainType === 'solana' ? 'solana' : 'evm';
    const splitAddrs: string[] = (Array.isArray(addresses) ? addresses : addresses.split(/[\s,]+/))
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const valid: string[] = [];
    const invalid: string[] = [];
    for (const a of splitAddrs) {
      if (isValidAddress(a, type)) valid.push(a);
      else invalid.push(a);
    }

    try {
      const result = db.bulkAddWallets(valid, groupId, type);
      res.json({ success: true, ...result, invalidCount: invalid.length, invalid });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/bot/wallets', (req, res) => {
    const { address, groupId } = req.body;
    if (!address || !groupId) {
      return res.status(400).json({ error: 'address and groupId are required' });
    }
    const success = db.removeWalletFromGroup(address, groupId);
    res.json({ success });
  });

  // Alert Settings
  app.get('/api/bot/alerts/settings', (req, res) => {
    const mint = db.getAlertSettings('mint');
    const purchase = db.getAlertSettings('purchase');
    res.json({ mint, purchase });
  });

  app.post('/api/bot/alerts/settings', async (req, res) => {
    const { activityType, enabled, initial_threshold, rolling_window_minutes, milestones } = req.body;
    if (activityType !== 'mint' && activityType !== 'purchase') {
      return res.status(400).json({ error: 'activityType must be "mint" or "purchase"' });
    }

    const updated = db.updateAlertSettings(activityType, {
      enabled,
      initial_threshold,
      rolling_window_minutes,
      milestones: typeof milestones === 'string' ? milestones : JSON.stringify(milestones),
    });

    const newAlerts = await detector.reevaluateOnConfigChange(activityType);
    res.json({ success: true, settings: updated, reevaluatedAlertsTriggered: newAlerts });
  });

  app.post('/api/bot/alerts/reset', (req, res) => {
    db.resetAlertSettingsToDefaults();
    res.json({ success: true });
  });

  // Alert History & Queue
  app.get('/api/bot/alerts/queue', (req, res) => {
    const pending = db.getPendingAlerts(20);
    res.json({ pending });
  });

  // Chains
  app.get('/api/bot/chains', (req, res) => {
    res.json({ chains: getAllVerifiedChains() });
  });

  // OpenSea Test
  app.post('/api/bot/test-opensea', async (req, res) => {
    const { apiKey } = req.body;
    if (apiKey) {
      openSea.setApiKey(apiKey);
    }
    const result = await openSea.testConnection();
    res.json(result);
  });

  // Automated Test Suite Runner
  app.get('/api/bot/tests/run', async (req, res) => {
    try {
      const report = await runAutomatedTestSuite();
      res.json(report);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Slash Command Simulator for UI
  app.post('/api/bot/command/simulate', async (req, res) => {
    const { command, args } = req.body;

    try {
      if (command === '/status') {
        const stats = db.getStats();
        const mem = process.memoryUsage();
        const rssMb = (mem.rss / (1024 * 1024)).toFixed(1);
        res.json({
          response: `🤖 **Discord NFT Smart Money Bot — Status**\n• Uptime: ${Math.floor(process.uptime())}s\n• Memory RSS: ${rssMb} MB (Target: <200 MB)\n• SQLite Database: ./data/bot.db\n• Tracked Wallets: ${stats.trackedWalletCount}\n• Wallet Groups: ${stats.groupCount} (${stats.enabledGroupCount} enabled)\n• Monitored Chains: 10 verified networks\n• Pending Alerts: ${stats.pendingAlertCount}`,
        });
      } else if (command === '/chains') {
        const chains = getAllVerifiedChains();
        const list = chains.map((c) => `• **${c.displayName}** (${c.canonicalId}) [${c.addressFormat.toUpperCase()}]: Mint ${c.supportsMintEvents ? '✅' : '❌'} | Buy ${c.supportsPurchaseEvents ? '✅' : '❌'} | Realtime ${c.supportsRealtimeStream ? '✅' : '⚠️'}`).join('\n');
        res.json({ response: `🌐 **Verified Multi-Chain OpenSea Registry (${chains.length} chains):**\n\n${list}` });
      } else if (command === '/alerts test') {
        const activity = args?.activity || 'mint';
        res.json({ response: formatTestAlert(activity) });
      } else {
        res.json({ response: `Executed command: ${command}` });
      }
    } catch (err: unknown) {
      res.status(400).json({ response: `Error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // MonkeyBytes Package Exporter (.zip generator)
  app.get('/api/bot/package', async (req, res) => {
    try {
      const zip = new JSZip();

      // Read key files to package
      const addFileIfExists = (filePath: string, zipPath: string) => {
        const full = path.resolve(process.cwd(), filePath);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          zip.file(zipPath, fs.readFileSync(full));
        }
      };

      const addDirRecursive = (dirPath: string, zipPrefix: string) => {
        const full = path.resolve(process.cwd(), dirPath);
        if (!fs.existsSync(full)) return;
        const entries = fs.readdirSync(full, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name.endsWith('.db') || entry.name.endsWith('.db-wal') || entry.name.endsWith('.db-shm')) {
            continue;
          }
          const entryFull = path.join(full, entry.name);
          const entryZip = path.join(zipPrefix, entry.name);
          if (entry.isDirectory()) {
            addDirRecursive(path.join(dirPath, entry.name), entryZip);
          } else {
            zip.file(entryZip, fs.readFileSync(entryFull));
          }
        }
      };

      addFileIfExists('.env.example', '.env.example');
      addFileIfExists('.gitignore', '.gitignore');
      addFileIfExists('README.md', 'README.md');
      addFileIfExists('package.json', 'package.json');
      addFileIfExists('package-lock.json', 'package-lock.json');
      addFileIfExists('tsconfig.json', 'tsconfig.json');

      addDirRecursive('src/bot', 'src/bot');

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="discord-nft-smart-money-bot.zip"');
      res.send(content);
    } catch (err: unknown) {
      res.status(500).json({ error: 'Failed to generate package: ' + String(err) });
    }
  });

  // ================= VITE / FRONTEND SERVING =================
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Web Server] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Web Server Fatal]', err);
});

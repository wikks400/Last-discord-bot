# Discord Multi-Chain NFT Smart Money Bot (MonkeyBytes Edition)

A high-performance, low-resource Discord bot built with Node.js, TypeScript, and persistent SQLite storage. Monitors NFT minting and genuine NFT purchases from manually managed wallet groups across all OpenSea-supported blockchain networks. Detects coordinated multi-wallet spikes in real-time within configurable rolling windows and broadcasts instant alerts and milestone updates directly to Discord.

---

## Key Features

- **OpenSea-Only Event Authority**: Ingests mints and genuine sales directly from OpenSea v2 API and Stream architecture. Strictly excludes ordinary transfers, listings, offers, and cancellations.
- **Multi-Chain Capabilities Registry**: Centralized matrix covering Ethereum, Polygon, Base, Arbitrum One, Optimism, Avalanche C-Chain, BNB Chain, Blast, Zora, and Solana with chain-aware address validation and capability auditing.
- **Rolling-Window Spike Detection**: Evaluates distinct qualifying tracked wallets within sliding time windows (default: 60 minutes) based on actual OpenSea event timestamps.
- **Independent Mint & Purchase Engines**: Tracks minting volume and marketplace purchases independently with distinct thresholds and milestones.
- **Discord Slash-Command Configuration**: Full runtime control without touching code or restarting:
  - `/wallet add`, `/wallet bulk_add`, `/wallet list`, `/wallet remove`, `/wallet search`, `/wallet status`
  - `/group create`, `/group list`, `/group add_wallet`, `/group remove_wallet`, `/group enable`, `/group disable`, `/group delete`
  - `/alerts settings`, `/alerts set_threshold`, `/alerts set_window`, `/alerts add_milestone`, `/alerts remove_milestone`, `/alerts set_milestones`, `/alerts enable`, `/alerts disable`, `/alerts reset_defaults`, `/alerts test`
  - `/status`, `/stats`, `/chains`
- **Zero-Data Production Initialization**: Begins with zero fabricated activity, zero default groups, and zero pre-populated wallets.
- **Persistent SQLite Architecture**: Prepared statements, WAL mode, transactional deduplication, and a persistent notification recovery queue at `./data/bot.db`.
- **Low-Memory & Storage Optimization**: Engineered to operate well under the 200 MB RSS footprint target on resource-constrained containers.

---

## Deploying on MonkeyBytes

This deployment guide is tailored for [MonkeyBytes Free Node.js Hosting](https://dash.monkey-network.xyz/docs) running on isolated Pterodactyl-based containers.

### Verified Platform Specifications
- **RAM**: 2 GB allocation
- **Disk**: 2 GB SSD persistent container storage
- **CPU**: 300% dedicated share
- **Runtime**: Continuous 24/7 background process (no ephemeral cold starts)

---

### Step-by-Step Deployment Instructions

#### 1. Application Type Selection
Log into the MonkeyBytes dashboard at `https://dash.monkey-network.xyz/` and provision a new server slot selecting **Node.js** as your primary environment.

#### 2. Node.js Version
Select **Node.js 20 LTS** or **Node.js 22 LTS** in the server settings panel.

#### 3. Uploading Code & Files
1. In your server management page, toggle **Maintenance Mode** to **ON**. This gracefully stops the running container and locks file descriptors to prevent corrupted writes during upload.
2. Connect to your server using SFTP (credentials available under the **Settings / SFTP Details** tab) or use the web **File Manager**.
3. Upload the project files:
   - `src/` (complete TypeScript source code)
   - `package.json`
   - `package-lock.json`
   - `tsconfig.json`
   - `.env.example`
   - `server.ts`
4. **DO NOT** upload `node_modules/`, `.git/`, or existing local `.db` files.

#### 4. Environment Variables Configuration
In the MonkeyBytes dashboard, navigate to **Startup / Variables** (or create a `.env` file in the root directory via the File Manager):
```bash
DISCORD_BOT_TOKEN="your_bot_token"
DISCORD_CLIENT_ID="your_discord_application_id"
OPENSEA_API_KEY="your_opensea_v2_api_key"
ALERT_CHANNEL_ID="optional_discord_channel_id"
DATABASE_PATH="./data/bot.db"
PORT=3000
```
*Note: Ensure you use `DISCORD_BOT_TOKEN`, not `DISCORD_TOKEN`.*

#### 5. Installing Dependencies
In the web console tab or terminal:
```bash
npm ci
```
This guarantees an identical, synchronized installation matching `package-lock.json`.

#### 6. Startup Command
Configure the container Startup Command in the dashboard:
- To run the standalone Discord bot:
  ```bash
  npm run bot
  ```
- Or to run the bot alongside the web management dashboard:
  ```bash
  npm start
  ```

#### 7. Starting the Bot & Disabling Maintenance Mode
1. Return to the management overview and toggle **Maintenance Mode** to **OFF**.
2. Click **Start** to launch the bot container.

#### 8. SQLite Database Initialization & Storage Location
On first startup, the bot creates `./data/bot.db` with WAL mode enabled.
On MonkeyBytes, container storage located inside `/home/container/data` is persistent and survives container restarts and reboots.
*Verification Note:* To safeguard your data prior to code updates, use SFTP to download a backup copy of `./data/bot.db`.

#### 9. Verifying the Discord Bot is Online
Inspect the live console in the MonkeyBytes dashboard. You should observe:
```
[Discord] Bot logged in successfully as YourBotName#0000
[Monitor] Background coordinated OpenSea monitor started.
[Queue] Persistent alert delivery queue worker started.
```

#### 10. Slash Commands Verification
Ensure your Discord application has the `applications.commands` and `bot` OAuth2 scopes. In your Discord server, type `/` to confirm `/wallet`, `/group`, `/alerts`, `/status`, and `/chains` are listed.

#### 11. Creating Your First Group Manually
In Discord, execute:
```
/group create name:Alpha description:High volume mint wallets
```

#### 12. Adding Tracked Wallets
```
/wallet add address:0x1234567890123456789012345678901234567890 group:Alpha label:Whale 1
```
Or bulk add:
```
/wallet bulk_add addresses:0xAddr1, 0xAddr2, 0xAddr3 group:Alpha
```

#### 13. Configuring Alert Thresholds & Rolling Windows
```
/alerts set_threshold activity:mint wallets:3
/alerts set_window activity:mint minutes:60
/alerts add_milestone activity:mint milestone:6
/alerts test
```

#### 14. Troubleshooting & Diagnostics
- **OpenSea Authentication (HTTP 401/403)**: Check `OPENSEA_API_KEY` in your environment variables. Ensure no trailing spaces or quotation mark errors.
- **Discord Authentication (Error 401)**: Verify `DISCORD_BOT_TOKEN` in the Discord Developer Portal under the **Bot** tab (Reset Token if necessary).
- **Discord Missing Access (Error 50001)**: The bot lacks permission to view or post in the specified channel. Grant "View Channel", "Send Messages", and "Embed Links".
- **Memory Pressure**: Run `/status` in Discord to check current RSS memory. The bot includes automatic 14-day history pruning and bounded collection metadata caches.

---

## Local Development & Automated Tests

To run the automated test suite locally:
```bash
npm test
```
The test suite utilizes an isolated temporary database (`./data/test_runner.db`) and executes 30+ assertions covering group creation, multi-chain address checks, rolling window aggregation, duplicate suppression, and alert formatting.

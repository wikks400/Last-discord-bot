/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  ChatInputCommandInteraction,
} from 'discord.js';
import { BotDatabase } from '../db/database';
import { SmartMoneyDetector } from '../engine/detector';
import { CoordinatedMonitor } from '../engine/monitor';
import { allCommands, dispatchCommand } from './commands';

export class DiscordBotService {
  private client: Client;
  private token: string;
  private clientId: string;
  private db: BotDatabase;
  private detector: SmartMoneyDetector;
  private monitor: CoordinatedMonitor;
  private isConnected = false;

  constructor(
    token: string,
    clientId: string,
    db: BotDatabase,
    detector: SmartMoneyDetector,
    monitor: CoordinatedMonitor
  ) {
    this.token = token.trim();
    this.clientId = clientId.trim();
    this.db = db;
    this.detector = detector;
    this.monitor = monitor;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.setupListeners();
  }

  public getClient(): Client {
    return this.client;
  }

  public isReady(): boolean {
    return this.isConnected && this.client.isReady();
  }

  private setupListeners(): void {
    this.client.on(Events.ClientReady, (readyClient) => {
      this.isConnected = true;
      console.log(`[Discord] Bot logged in successfully as ${readyClient.user.tag}`);
    });

    this.client.on(Events.Error, (error) => {
      console.error('[Discord] Client error:', error.message);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      await dispatchCommand(interaction as ChatInputCommandInteraction, {
        db: this.db,
        detector: this.detector,
        monitor: this.monitor,
      });
    });
  }

  /**
   * Register slash commands with Discord REST API
   */
  public async registerSlashCommands(): Promise<{ success: boolean; count: number; error?: string }> {
    if (!this.token || !this.clientId) {
      return { success: false, count: 0, error: 'DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID required' };
    }

    try {
      const rest = new REST({ version: '10' }).setToken(this.token);
      const commandData = allCommands.map((cmd) => cmd.toJSON());

      await rest.put(Routes.applicationCommands(this.clientId), {
        body: commandData,
      });

      return { success: true, count: commandData.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, count: 0, error: msg };
    }
  }

  /**
   * Start Discord bot connection
   */
  public async start(): Promise<void> {
    if (!this.token) {
      console.warn('[Discord] Bot token not provided. Bot service not started.');
      return;
    }

    try {
      await this.registerSlashCommands();
      await this.client.login(this.token);
    } catch (err: unknown) {
      console.error('[Discord] Failed to login:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Graceful disconnect
   */
  public async stop(): Promise<void> {
    this.isConnected = false;
    await this.client.destroy();
  }
}

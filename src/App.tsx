/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Shield,
  Layers,
  Settings,
  Terminal,
  Download,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  ExternalLink,
  Cpu,
  Database as DbIcon,
  Server,
  Zap,
} from 'lucide-react';

interface BotStatus {
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  stats: {
    groupCount: number;
    enabledGroupCount: number;
    trackedWalletCount: number;
    seenEventCount: number;
    deliveredAlertCount: number;
    pendingAlertCount: number;
    dbSizeBytes: number;
  };
  monitorHealth: {
    isRunning: boolean;
    lastCheckTime: string | null;
    lastEventTime: string | null;
    totalEventsProcessed: number;
    recentErrors: { timestamp: string; message: string }[];
  };
  hasOpenSeaKey: boolean;
  hasDiscordToken: boolean;
  hasDiscordClientId: boolean;
  discordOnline?: boolean;
  botUser?: {
    tag: string;
    username: string;
    id: string;
  } | null;
  alertChannelId?: string | null;
  verifiedChainsCount: number;
}

interface GroupItem {
  id: string;
  name: string;
  description: string;
  enabled: number;
  wallet_count: number;
  created_at: string;
}

interface WalletItem {
  address: string;
  label: string;
  chain_type: string;
  groups: string[];
  added_at: string;
}

interface AlertSettings {
  mint: {
    activity_type: string;
    enabled: number;
    initial_threshold: number;
    rolling_window_minutes: number;
    milestones: string;
  };
  purchase: {
    activity_type: string;
    enabled: number;
    initial_threshold: number;
    rolling_window_minutes: number;
    milestones: string;
  };
}

interface ChainItem {
  canonicalId: string;
  openseaSlug: string;
  displayName: string;
  nativeCurrency: string;
  addressFormat: string;
  supportsMetadata: boolean;
  supportsVerification: boolean;
  supportsMintEvents: boolean;
  supportsPurchaseEvents: boolean;
  supportsRealtimeStream: boolean;
  supportsHistoricalRetrieval: boolean;
  knownRestrictions: string;
  verificationNotes: string;
}

interface TestReport {
  timestamp: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  results: Array<{
    name: string;
    category: string;
    passed: boolean;
    error?: string;
    durationMs: number;
  }>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'wallets' | 'alerts' | 'chains' | 'tests' | 'deploy'>('overview');
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  const [chains, setChains] = useState<ChainItem[]>([]);
  const [pendingQueue, setPendingQueue] = useState<any[]>([]);
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string>('Type or select a slash command to simulate Discord execution.');

  // Group creation modal state
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // Add wallet modal state
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [walletGroupId, setWalletGroupId] = useState('');
  const [walletLabel, setWalletLabel] = useState('');
  const [walletChainType, setWalletChainType] = useState<'evm' | 'solana'>('evm');
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkAddresses, setBulkAddresses] = useState('');

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');
  const [chainSearch, setChainSearch] = useState('');

  // Discord Alert Channel State
  const [channelInput, setChannelInput] = useState('');
  const [isSavingChannel, setIsSavingChannel] = useState(false);

  // Fetch status and core data
  const fetchData = async () => {
    try {
      const [resStatus, resGroups, resWallets, resAlerts, resChains, resQueue] = await Promise.all([
        fetch('/api/bot/status').then((r) => r.json()),
        fetch('/api/bot/groups').then((r) => r.json()),
        fetch('/api/bot/wallets').then((r) => r.json()),
        fetch('/api/bot/alerts/settings').then((r) => r.json()),
        fetch('/api/bot/chains').then((r) => r.json()),
        fetch('/api/bot/alerts/queue').then((r) => r.json()),
      ]);

      setStatus(resStatus);
      if (resStatus?.alertChannelId && !channelInput) {
        setChannelInput(resStatus.alertChannelId);
      }
      setGroups(resGroups.groups || []);
      setWallets(resWallets.wallets || []);
      setAlerts(resAlerts);
      setChains(resChains.chains || []);
      setPendingQueue(resQueue.pending || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Run tests
  const handleRunTests = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/tests/run');
      const data = await res.json();
      setTestReport(data);
      setActiveTab('tests');
    } catch (err: unknown) {
      alert('Failed to execute automated tests: ' + String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Simulate command
  const simulateCommand = async (cmd: string, args: Record<string, any> = {}) => {
    setTerminalOutput(`> ${cmd}\nExecuting command on Discord Bot engine...`);
    try {
      const res = await fetch('/api/bot/command/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, args }),
      });
      const data = await res.json();
      setTerminalOutput(`> ${cmd}\n\n${data.response}`);
    } catch (err: unknown) {
      setTerminalOutput(`> ${cmd}\n\n❌ Error: ${String(err)}`);
    }
  };

  // Group operations
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    try {
      const res = await fetch('/api/bot/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), description: newGroupDesc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupDesc('');
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleGroup = async (groupId: string, currentEnabled: number) => {
    try {
      await fetch(`/api/bot/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: currentEnabled === 1 ? 0 : 1 }),
      });
      fetchData();
    } catch {
      // ignore
    }
  };

  const handleDeleteGroup = async (groupId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete group "${name}"?\nAll membership records will be deleted. Wallets also assigned to other groups will be safely preserved.`)) {
      return;
    }
    try {
      await fetch(`/api/bot/groups/${groupId}`, { method: 'DELETE' });
      fetchData();
    } catch {
      // ignore
    }
  };

  // Wallet operations
  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletGroupId) {
      alert('Please select or create a group first');
      return;
    }

    try {
      if (isBulkMode) {
        const res = await fetch('/api/bot/wallets/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: bulkAddresses, groupId: walletGroupId, chainType: walletChainType }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(`Bulk added: ${data.added} addresses. Skipped: ${data.skipped}. Invalid: ${data.invalidCount || 0}`);
      } else {
        const res = await fetch('/api/bot/wallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: walletAddress.trim(),
            groupId: walletGroupId,
            label: walletLabel.trim(),
            chainType: walletChainType,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }

      setShowAddWallet(false);
      setWalletAddress('');
      setWalletLabel('');
      setBulkAddresses('');
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveWallet = async (address: string, groupName: string) => {
    const grp = groups.find((g) => g.name === groupName);
    if (!grp) return;
    if (!confirm(`Remove ${address.substring(0, 8)}... from group "${groupName}"?`)) return;

    try {
      await fetch('/api/bot/wallets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, groupId: grp.id }),
      });
      fetchData();
    } catch {
      // ignore
    }
  };

  // Alert settings update
  const handleUpdateAlertSetting = async (
    activityType: 'mint' | 'purchase',
    updates: {
      initial_threshold?: number;
      rolling_window_minutes?: number;
      milestones?: number[];
      enabled?: number;
    }
  ) => {
    try {
      await fetch('/api/bot/alerts/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityType, ...updates }),
      });
      fetchData();
    } catch {
      // ignore
    }
  };

  const handleResetDefaults = async () => {
    if (!confirm('Reset alert thresholds, windows, and milestones to factory defaults (Threshold 3, Window 60m, Milestones [6, 12, 15])? Wallets and groups will be preserved.')) {
      return;
    }
    try {
      await fetch('/api/bot/alerts/reset', { method: 'POST' });
      fetchData();
    } catch {
      // ignore
    }
  };

  const handleSaveAlertChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingChannel(true);
    try {
      const res = await fetch('/api/bot/alerts/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channelInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchData();
    } catch (err: unknown) {
      alert('Failed to save channel: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingChannel(false);
    }
  };

  // Filtered lists
  const filteredWallets = wallets.filter(
    (w) =>
      w.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.groups.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredChains = chains.filter(
    (c) =>
      c.displayName.toLowerCase().includes(chainSearch.toLowerCase()) ||
      c.canonicalId.toLowerCase().includes(chainSearch.toLowerCase()) ||
      c.addressFormat.toLowerCase().includes(chainSearch.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">Discord NFT Smart Money Bot</h1>
                {status?.discordOnline ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Online: {status.botUser?.tag || 'Discord Bot'}
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      await fetch('/api/bot/reconnect', { method: 'POST' });
                      fetchData();
                    }}
                    title="Click to trigger Discord login"
                    className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono border border-amber-500/20 hover:bg-amber-500/20 transition-colors flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    <span>Offline (Click to Connect)</span>
                  </button>
                )}
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono border border-indigo-500/20">
                  MonkeyBytes Ready
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                <span>Multi-Chain OpenSea v2</span>
                <span aria-hidden="true">·</span>
                <span>Persistent SQLite (`./data/bot.db`)</span>
                <span aria-hidden="true">·</span>
                <span>RSS: {status ? `${status.memory.rssMb} MB` : 'Checking...'} (Target: &lt;200MB)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunTests}
              disabled={isLoading}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors shadow-sm"
            >
              <Play className="w-3.5 h-3.5 text-indigo-400" />
              <span>{isLoading ? 'Running Tests...' : 'Run Automated Tests'}</span>
            </button>

            <a
              href="/api/bot/package"
              download="discord-nft-smart-money-bot.zip"
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-md shadow-indigo-600/20"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Deploy Package (.zip)</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div className="border-b border-slate-800 bg-slate-900/40 px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto py-2">
          {[
            { id: 'overview', label: 'Monitor & Console', icon: Terminal },
            { id: 'wallets', label: `Wallets & Groups (${wallets.length})`, icon: Layers },
            { id: 'alerts', label: 'Alert Thresholds', icon: Settings },
            { id: 'chains', label: `Multi-Chain Matrix (${chains.length})`, icon: Shield },
            { id: 'tests', label: testReport ? `Test Suite (${testReport.passedTests}/${testReport.totalTests})` : 'Test Suite', icon: Activity },
            { id: 'deploy', label: 'MonkeyBytes Guide', icon: Server },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all ${
                  isActive
                    ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {/* TAB 1: OVERVIEW & CONSOLE */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* System Status Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Memory RSS (Target &lt;200MB)</span>
                  <Cpu className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl font-bold text-white">
                  {status ? `${status.memory.rssMb} MB` : '...'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Heap: {status ? `${status.memory.heapUsedMb} MB / ${status.memory.heapTotalMb} MB` : '...'}
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>SQLite Database</span>
                  <DbIcon className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-white">
                  {status ? `${(status.stats.dbSizeBytes / 1024).toFixed(1)} KB` : '...'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Path: `./data/bot.db` (Persistent)
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Tracked Wallets</span>
                  <Layers className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold text-white">
                  {status ? status.stats.trackedWalletCount : 0}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Across {status ? status.stats.groupCount : 0} manually created groups
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                  <span>Delivered / Queue</span>
                  <Zap className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold text-white">
                  {status ? `${status.stats.deliveredAlertCount} / ${status.stats.pendingAlertCount}` : '0 / 0'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Deduplicated alerts dispatched
                </div>
              </div>
            </div>

            {/* Split Grid: Interactive Slash Terminal & Live Alert Feeds */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Slash Command Simulator */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-900">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-semibold text-white">Discord Slash Command Simulator</h2>
                  </div>
                  <span className="text-xs text-slate-500">Live Bot Engine Interop</span>
                </div>

                <div className="p-4 flex-1 flex flex-col space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => simulateCommand('/status')}
                      className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono border border-slate-700 transition-colors"
                    >
                      /status
                    </button>
                    <button
                      onClick={() => simulateCommand('/chains')}
                      className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono border border-slate-700 transition-colors"
                    >
                      /chains
                    </button>
                    <button
                      onClick={() => simulateCommand('/alerts test', { activity: 'mint' })}
                      className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono border border-slate-700 transition-colors"
                    >
                      /alerts test (mint)
                    </button>
                    <button
                      onClick={() => simulateCommand('/alerts test', { activity: 'purchase' })}
                      className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono border border-slate-700 transition-colors"
                    >
                      /alerts test (purchase)
                    </button>
                  </div>

                  <div className="flex-1 bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-300 border border-slate-800/80 overflow-y-auto max-h-[350px] whitespace-pre-wrap leading-relaxed shadow-inner">
                    {terminalOutput}
                  </div>
                </div>
              </div>

              {/* Live Alerts Queue Preview */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-900">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-white">Persistent Notification Recovery Queue</h2>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">{pendingQueue.length} pending</span>
                </div>

                <div className="p-4 flex-1 overflow-y-auto max-h-[420px] space-y-3">
                  {pendingQueue.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 text-sm">
                      <CheckCircle2 className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                      <p>Queue is empty. No pending alerts awaiting Discord dispatch.</p>
                      <p className="text-xs text-slate-600 mt-1">Alerts are queued when 3+ distinct wallets trigger rolling spikes.</p>
                    </div>
                  ) : (
                    pendingQueue.map((item) => (
                      <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-400 uppercase tracking-wider">
                            {item.activity_type === 'mint' ? '🚨 Mint Spike Alert' : '🚨 Buy Spike Alert'}
                          </span>
                          <span className="text-slate-500 font-mono">{item.created_at.substring(11, 19)}</span>
                        </div>
                        <div className="text-white font-medium">{item.collection_name} ({item.chain})</div>
                        <div className="text-slate-400 flex items-center gap-3">
                          <span>Unique Wallets: <strong className="text-slate-200">{item.unique_wallets}</strong></span>
                          <span aria-hidden="true">·</span>
                          <span>Total NFTs: <strong className="text-slate-200">{item.total_nfts || 'N/A'}</strong></span>
                          <span aria-hidden="true">·</span>
                          <span>Window: {item.window_minutes}m</span>
                        </div>
                        {item.opensea_url && (
                          <a
                            href={item.opensea_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:underline flex items-center gap-1 text-[11px]"
                          >
                            <span>OpenSea Collection</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WALLETS & GROUPS */}
        {activeTab === 'wallets' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">Wallet Groups & Tracked Addresses</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Production rule enforced: Zero default groups or sample wallets. All tracked wallets are manually created by authorized administrators.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCreateGroup(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Group</span>
                </button>
                <button
                  onClick={() => setShowAddWallet(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Wallet</span>
                </button>
              </div>
            </div>

            {/* Groups Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {groups.length === 0 ? (
                <div className="col-span-3 bg-slate-900/40 border border-slate-800 rounded-xl p-8 text-center text-slate-500">
                  <Layers className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-60" />
                  <p className="text-sm font-medium text-slate-400">No wallet groups created yet.</p>
                  <p className="text-xs text-slate-600 mt-1">Use "Create Group" or Discord slash command `/group create` to set up your first tracking group.</p>
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-white text-sm">{group.name}</h3>
                        <button
                          onClick={() => handleToggleGroup(group.id, group.enabled)}
                          className={`text-xs px-2 py-0.5 rounded font-mono transition-colors ${
                            group.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-slate-800 text-slate-500 border border-slate-700'
                          }`}
                        >
                          {group.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{group.description || 'No description provided'}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs text-slate-500">
                      <span><strong>{group.wallet_count}</strong> wallet(s)</span>
                      <button
                        onClick={() => handleDeleteGroup(group.id, group.name)}
                        className="text-rose-400/80 hover:text-rose-300 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Wallets Table */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search wallet address, label, or group..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  Showing {filteredWallets.length} of {wallets.length} tracked wallets
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Wallet Address</th>
                      <th className="px-4 py-3 font-semibold">Chain Family</th>
                      <th className="px-4 py-3 font-semibold">Label / Note</th>
                      <th className="px-4 py-3 font-semibold">Assigned Groups</th>
                      <th className="px-4 py-3 font-semibold">Added At</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredWallets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          No wallets match your criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredWallets.map((wallet) => (
                        <tr key={wallet.address} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-slate-200">
                            {wallet.address.substring(0, 10)}...{wallet.address.slice(-6)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-slate-400 uppercase text-[11px]">{wallet.chain_type}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-400">{wallet.label || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {wallet.groups.map((g) => (
                                <span key={g} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                                  {g}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                            {wallet.added_at.substring(0, 10)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {wallet.groups.map((grpName) => (
                              <button
                                key={grpName}
                                onClick={() => handleRemoveWallet(wallet.address, grpName)}
                                title={`Remove from ${grpName}`}
                                className="text-slate-500 hover:text-rose-400 ml-2 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            ))}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ALERT THRESHOLDS */}
        {activeTab === 'alerts' && alerts && (
          <div className="space-y-6 max-w-4xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Adjustable Alert Thresholds & Rolling Windows</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Changes save to SQLite immediately and take effect without restarting the bot. Existing activity in rolling window is re-evaluated.
                </p>
              </div>
              <button
                onClick={handleResetDefaults}
                className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset Factory Defaults</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Mint Alert Settings */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-indigo-400" />
                    <h3 className="font-bold text-white text-sm">NFT Mint Activity Alerts</h3>
                  </div>
                  <button
                    onClick={() =>
                      handleUpdateAlertSetting('mint', {
                        enabled: alerts.mint.enabled === 1 ? 0 : 1,
                      })
                    }
                    className={`text-xs px-2.5 py-1 rounded font-mono transition-colors ${
                      alerts.mint.enabled
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}
                  >
                    {alerts.mint.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Initial Threshold (Distinct Wallets)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={alerts.mint.initial_threshold}
                      onChange={(e) =>
                        handleUpdateAlertSetting('mint', {
                          initial_threshold: parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white w-24 focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-xs text-slate-500">Default: 3 wallets</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Rolling Activity Window (Minutes)
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={alerts.mint.rolling_window_minutes}
                      onChange={(e) =>
                        handleUpdateAlertSetting('mint', {
                          rolling_window_minutes: parseInt(e.target.value, 10) || 60,
                        })
                      }
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>60 minutes (Default)</option>
                      <option value={120}>120 minutes</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Follow-Up Alert Milestones
                  </label>
                  <input
                    type="text"
                    value={alerts.mint.milestones}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        if (Array.isArray(parsed)) {
                          handleUpdateAlertSetting('mint', { milestones: parsed });
                        }
                      } catch {
                        // wait for valid json
                      }
                    }}
                    placeholder="[6, 12, 15]"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Default: [6, 12, 15]. Must be greater than initial threshold.</p>
                </div>
              </div>

              {/* Purchase Alert Settings */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-bold text-white text-sm">NFT Purchase Activity Alerts</h3>
                  </div>
                  <button
                    onClick={() =>
                      handleUpdateAlertSetting('purchase', {
                        enabled: alerts.purchase.enabled === 1 ? 0 : 1,
                      })
                    }
                    className={`text-xs px-2.5 py-1 rounded font-mono transition-colors ${
                      alerts.purchase.enabled
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}
                  >
                    {alerts.purchase.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Initial Threshold (Distinct Wallets)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={alerts.purchase.initial_threshold}
                      onChange={(e) =>
                        handleUpdateAlertSetting('purchase', {
                          initial_threshold: parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white w-24 focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-xs text-slate-500">Default: 3 wallets</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Rolling Activity Window (Minutes)
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={alerts.purchase.rolling_window_minutes}
                      onChange={(e) =>
                        handleUpdateAlertSetting('purchase', {
                          rolling_window_minutes: parseInt(e.target.value, 10) || 60,
                        })
                      }
                      className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>60 minutes (Default)</option>
                      <option value={120}>120 minutes</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Follow-Up Alert Milestones
                  </label>
                  <input
                    type="text"
                    value={alerts.purchase.milestones}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        if (Array.isArray(parsed)) {
                          handleUpdateAlertSetting('purchase', { milestones: parsed });
                        }
                      } catch {
                        // wait for valid json
                      }
                    }}
                    placeholder="[6, 12, 15]"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Default: [6, 12, 15]. Must be greater than initial threshold.</p>
                </div>
              </div>
            </div>

            {/* Discord Alert Broadcast Destination */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-400" />
                  <h3 className="font-bold text-white text-sm">Discord Alert Destination Channel</h3>
                </div>
                {status?.alertChannelId ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20">
                    Channel ID: {status.alertChannelId}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono border border-amber-500/20">
                    Defaulting to Server Alerts / General
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400">
                Specify the Discord text channel ID where mint and purchase smart money alerts will be broadcast. You can also configure this directly in Discord using the slash command <code className="text-indigo-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">/alerts set_channel channel:#channel-name</code>.
              </p>

              <form onSubmit={handleSaveAlertChannel} className="flex items-center gap-3 pt-1">
                <div className="flex-1 max-w-md">
                  <input
                    type="text"
                    value={channelInput}
                    onChange={(e) => setChannelInput(e.target.value)}
                    placeholder="e.g. 1561061232121749618 (for #alpha)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingChannel}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {isSavingChannel ? 'Saving...' : 'Save Channel'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: MULTI-CHAIN REGISTRY */}
        {activeTab === 'chains' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">Centralized Multi-Chain Capabilities Registry</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Verified against official OpenSea v2 API and Stream specifications. Capabilities are audited individually per network.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={chainSearch}
                  onChange={(e) => setChainSearch(e.target.value)}
                  placeholder="Filter chains..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredChains.map((c) => (
                <div key={c.canonicalId} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">{c.displayName}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        Slug: `{c.openseaSlug}` · Format: {c.addressFormat.toUpperCase()} · Native: {c.nativeCurrency}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs py-2 border-y border-slate-800/80">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Mint Tracking</span>
                      <span className={c.supportsMintEvents ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
                        {c.supportsMintEvents ? '✓ Verified' : '✗ Unavailable'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Purchase Tracking</span>
                      <span className={c.supportsPurchaseEvents ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>
                        {c.supportsPurchaseEvents ? '✓ Verified' : '✗ Unavailable'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Real-time Stream</span>
                      <span className={c.supportsRealtimeStream ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                        {c.supportsRealtimeStream ? '✓ WebSocket' : '⚠ REST Polling'}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs space-y-1">
                    <div className="text-slate-400">
                      <strong className="text-slate-300">Restrictions:</strong> {c.knownRestrictions}
                    </div>
                    <div className="text-slate-500 text-[11px]">
                      <strong className="text-slate-400">Audit Notes:</strong> {c.verificationNotes}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: TEST SUITE */}
        {activeTab === 'tests' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Automated Bot Engine Test Suite</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tests execute against an isolated sandbox database (`./data/test_runner.db`). The production database remains 100% pristine.
                </p>
              </div>
              <button
                onClick={handleRunTests}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Running Suite...' : 'Re-Run All Tests'}</span>
              </button>
            </div>

            {testReport && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block">Total Tests</span>
                    <span className="text-2xl font-bold text-white">{testReport.totalTests}</span>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block">Passed</span>
                    <span className="text-2xl font-bold text-emerald-400">{testReport.passedTests}</span>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block">Failed</span>
                    <span className="text-2xl font-bold text-rose-400">{testReport.failedTests}</span>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <span className="text-xs text-slate-400 block">Duration</span>
                    <span className="text-2xl font-bold text-slate-300">{testReport.durationMs} ms</span>
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80">
                  {testReport.results.map((r, i) => (
                    <div key={i} className="p-3.5 flex items-start justify-between text-xs hover:bg-slate-800/20 transition-colors">
                      <div className="flex items-start gap-2.5">
                        {r.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-medium text-slate-200">{r.name}</div>
                          <div className="text-slate-500 font-mono text-[11px] mt-0.5">
                            Category: {r.category} · Duration: {r.durationMs}ms
                          </div>
                          {r.error && <div className="text-rose-400 font-mono text-[11px] mt-1 bg-rose-500/10 p-2 rounded">{r.error}</div>}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                          r.passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {r.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: MONKEYBYTES GUIDE */}
        {activeTab === 'deploy' && (
          <div className="space-y-6 max-w-4xl">
            <div className="bg-slate-900/80 border border-indigo-500/30 rounded-xl p-6 relative overflow-hidden">
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Deploying to MonkeyBytes Free Hosting</h2>
                  <p className="text-xs text-slate-300 mt-1 max-w-xl">
                    MonkeyBytes provides 2GB RAM, 2GB SSD storage, 300% CPU share, and continuous 24/7 background execution on isolated containers.
                  </p>
                </div>
                <a
                  href="/api/bot/package"
                  download="discord-nft-smart-money-bot.zip"
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-600/30 flex items-center gap-2 shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Project Archive (.zip)</span>
                </a>
              </div>
            </div>

            <div className="space-y-4">
              {[
                {
                  step: '1',
                  title: 'Server Provisioning',
                  desc: 'In dash.monkey-network.xyz, create a new server slot selecting Node.js as the runtime and Node 20 LTS or Node 22 LTS.',
                },
                {
                  step: '2',
                  title: 'Toggle Maintenance Mode ON (Crucial)',
                  desc: 'Before uploading files via SFTP or Web File Manager, turn Maintenance Mode ON in the dashboard. This prevents file locking or partial write errors.',
                },
                {
                  step: '3',
                  title: 'Upload Code Archive',
                  desc: 'Upload the unzipped project files (src/, package.json, package-lock.json, tsconfig.json, server.ts). Do not upload node_modules or secret .env files.',
                },
                {
                  step: '4',
                  title: 'Configure Required Environment Variables',
                  desc: 'In Startup / Variables, set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and OPENSEA_API_KEY. Optional: ALERT_CHANNEL_ID.',
                },
                {
                  step: '5',
                  title: 'Install Dependencies with npm ci',
                  desc: 'Run npm ci in the web terminal to deterministically install all packages against package-lock.json.',
                },
                {
                  step: '6',
                  title: 'Startup Command & Launch',
                  desc: 'Set Startup Command to npm run bot (for standalone Discord bot) or npm start (for dashboard + bot). Toggle Maintenance Mode OFF and click Start.',
                },
                {
                  step: '7',
                  title: 'Verify & Manage via Discord',
                  desc: 'In your Discord server, type /status to verify online health, /group create to make your first group, and /wallet add to start tracking smart money.',
                },
              ].map((item) => (
                <div key={item.step} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-start gap-4">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 font-bold flex items-center justify-center shrink-0 border border-indigo-500/30 text-xs">
                    {item.step}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal: Create Group */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-1">Create New Wallet Group</h3>
            <p className="text-xs text-slate-400 mb-4">Groups organize tracked addresses for distinct-wallet smart money alerts.</p>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Group Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Whales, TopMinters, AlphaTraders"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="e.g. Verified high conviction NFT wallets"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateGroup(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Wallet */}
      {showAddWallet && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-white">Add Tracked Wallets</h3>
                <p className="text-xs text-slate-400">Validate and assign addresses to a group.</p>
              </div>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setIsBulkMode(false)}
                  className={`px-2 py-1 rounded ${!isBulkMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setIsBulkMode(true)}
                  className={`px-2 py-1 rounded ${isBulkMode ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}
                >
                  Bulk Add
                </button>
              </div>
            </div>

            <form onSubmit={handleAddWallet} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Target Group</label>
                <select
                  value={walletGroupId}
                  onChange={(e) => setWalletGroupId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select a group...</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.wallet_count} wallets)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Chain Address Format</label>
                <select
                  value={walletChainType}
                  onChange={(e) => setWalletChainType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="evm">EVM (Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, BSC)</option>
                  <option value="solana">Solana (Base58 Address)</option>
                </select>
              </div>

              {!isBulkMode ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Wallet Address</label>
                    <input
                      type="text"
                      value={walletAddress}
                      onChange={(e) => setWalletAddress(e.target.value)}
                      placeholder={walletChainType === 'evm' ? '0x...' : 'Base58 string...'}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Label / Trader Name (Optional)</label>
                    <input
                      type="text"
                      value={walletLabel}
                      onChange={(e) => setWalletLabel(e.target.value)}
                      placeholder="e.g. Whale 1, Pranksy, Smart Mint Lead"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Wallet Addresses (Separated by comma or newline)</label>
                  <textarea
                    rows={4}
                    value={bulkAddresses}
                    onChange={(e) => setBulkAddresses(e.target.value)}
                    placeholder="0x1111111111111111111111111111111111111111&#10;0x2222222222222222222222222222222222222222"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddWallet(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg"
                >
                  {isBulkMode ? 'Bulk Add Wallets' : 'Add Wallet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

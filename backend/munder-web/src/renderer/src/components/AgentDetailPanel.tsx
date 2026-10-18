import { useEffect, useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelBadge } from './PixelBadge';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { PtyTerminalView } from './PtyTerminalView';
import { terminalInstanceKey } from './terminalRecovery';
import { MessageQueueComposer } from './MessageQueueComposer';
import { CommandCenterPanel } from './CommandCenterPanel';
import { disposeTerminal } from './terminalPool';
import { SidebarTabs } from './SidebarTabs';
import { ThreadsPanel } from './ThreadsPanel';
import { CoosActivityTraces } from './CoosActivityTraces';
import { ToolWaterfall } from './ToolWaterfall';
import { AgentControlStrip } from './AgentControlStrip';
import { AgentProfilePanel } from './AgentProfilePanel';
import { GitTab } from './GitTab';
import { Icon } from './Icon';
import { useStore, type Agent, type AgentAIConfig } from '@/store/store';
import { usePtyParser } from '@/hooks/usePtyParser';

export interface AgentDetailPanelProps {
  agent: Agent;
}

export function AgentDetailPanel({ agent }: AgentDetailPanelProps) {
  const accent = agent.accent ?? 'sky';
  const [openTerminalState, setOpenTerminalState] = useState<'idle' | 'opening' | 'ok' | 'error'>('idle');
  const [openTerminalError, setOpenTerminalError] = useState<string | undefined>();
  const archiveAgent = useStore(s => s.archiveAgent);
  const updateAgent = useStore(s => s.updateAgent);
  const setFullscreen = useStore(s => s.setFullscreen);
  const fullscreenAgentId = useStore(s => s.fullscreenAgentId);
  const sidebarTab = useStore(s => s.sidebarTab);
  const setSidebarTab = useStore(s => s.setSidebarTab);
  const coosMode = useStore(s => s.coosMode);
  const fetchAgentProfile = useStore(s => s.fetchAgentProfile);
  const isReal = !!agent.ptyId;

  useEffect(() => {
    if (coosMode) void fetchAgentProfile(agent.id);
  }, [agent.id, coosMode, fetchAgentProfile]);
  // While this agent is shown in the fullscreen overlay, the fullscreen view
  // owns the pty (it sizes it to fill the screen). Keeping the embedded terminal
  // mounted too means two xterms fight over the pty's cols/rows — which corrupts
  // the display and breaks scrolling. So we unmount the embedded one here; it
  // re-mounts and re-fits when fullscreen closes.
  const isFullscreenedHere = fullscreenAgentId === agent.id;

  const onPtyStream = usePtyParser(agent.id);

  // God agent: command center by default; profile tab shows employee card in COOS mode
  if (agent.isGod && (!coosMode || sidebarTab !== 'profile')) {
    return <CommandCenterPanel agent={agent} />;
  }

  const openTerminal = async () => {
    setOpenTerminalState('opening');
    setOpenTerminalError(undefined);
    try {
      const result = await window.cth.openTerminalAt(agent.cwd);
      if (result.ok) {
        setOpenTerminalState('ok');
        setTimeout(() => setOpenTerminalState('idle'), 1500);
      } else {
        setOpenTerminalState('error');
        setOpenTerminalError(result.error ?? 'unknown error');
        setTimeout(() => setOpenTerminalState('idle'), 4000);
      }
    } catch (e) {
      setOpenTerminalState('error');
      setOpenTerminalError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setOpenTerminalState('idle'), 4000);
    }
  };

  const onKill = async () => {
    if (!agent.ptyId) return;
    if (!confirm(`Close ${agent.name}? The PTY process will terminate and the agent is archived (kept in history, off the floor).`)) return;
    await window.cth.killPty(agent.ptyId);
    disposeTerminal(agent.ptyId);
    archiveAgent(agent.id);
  };

  return (
    <PixelPanel
      variant="default"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 0,
        overflow: 'hidden'
      }}
      noPadding
    >
      {/* Thin header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px',
        background: 'var(--cth-cream-100)',
        borderBottom: '1px solid var(--cth-ink-700)',
        flexShrink: 0
      }}>
        <div style={{
          width: 32, height: 32,
          background: `var(--cth-${accent}-light)`,
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden',
          flexShrink: 0
        }}>
          <SpritePortrait character={agent.character} scale={1} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--cth-font-display)',
            fontSize: 10, lineHeight: '14px',
            color: 'var(--cth-ink-900)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>{agent.name.toUpperCase()}</div>
          <div style={{
            display: 'flex', gap: 6, alignItems: 'center', marginTop: 1
          }}>
            <PixelBadge status={agent.status} />
            <span style={{
              fontSize: 12, color: 'var(--cth-ink-500)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>{agent.project}</span>
          </div>
        </div>
        {/* v0.3.4: the IDE lives at agent level (replaces the old files tab) —
            opens the full-window Monaco editor rooted at this agent's workspace. */}
        <PixelButton variant="secondary" size="sm" onClick={() => useStore.getState().setIdeOpen(true, agent.id)} disabled={coosMode && !agent.cwd}>
          <span title={`Open the IDE — file editor + git diff for ${agent.project}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="code" /> IDE
          </span>
        </PixelButton>
        {!coosMode && (
        <PixelButton variant="secondary" size="sm" onClick={openTerminal} disabled={openTerminalState === 'opening'}>
          <span title={`open Terminal.app at ${agent.cwd}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="terminal" />
            {openTerminalState === 'opening' ? '...' : openTerminalState === 'ok' ? 'ok' : openTerminalState === 'error' ? 'err' : 'open'}
          </span>
        </PixelButton>
        )}
        {isReal && (
          <PixelButton variant="destructive" size="sm" onClick={onKill}>
            <Icon name="x" />
          </PixelButton>
        )}
      </div>

      {openTerminalError && (
        <div style={{
          fontSize: 12, color: 'var(--cth-coral)',
          padding: '2px 8px',
          background: 'var(--cth-coral-light)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{openTerminalError}</div>
      )}

      {/* #7C — operator control (pause / halt / steer) for live agents */}
      {isReal && <AgentControlStrip agentId={agent.id} />}

      {/* Tabs */}
      <SidebarTabs
        current={sidebarTab}
        accent={accent}
        onChange={setSidebarTab}
        coosMode={coosMode}
        hasTerminal={isReal}
      />

      {/* Active tab body — fills remaining space */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {sidebarTab === 'profile' && (
          <AgentProfilePanel agent={agent} />
        )}

        {sidebarTab === 'terminal' && (
          isReal && agent.ptyId ? (
            isFullscreenedHere ? (
              <EmptyTab title="In fullscreen">
                This terminal is open in fullscreen. Press Esc or exit fullscreen to bring it back here.
              </EmptyTab>
            ) : (
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <PtyTerminalView
                  key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
                  ptyId={agent.ptyId}
                  onStreamData={onPtyStream}
                  onUserPrompt={(t) => {
                    updateAgent(agent.id, { lastPrompt: t });
                    if (t.trim().toLowerCase() === '/clear') {
                      updateAgent(agent.id, { contextTokens: 0, contextLimit: undefined, progress: 0 });
                    }
                    void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t });
                  }}
                  onToggleFullscreen={() => setFullscreen(agent.id)}
                  fullscreen={false}
                  embedded
                />
              </div>
              <MessageQueueComposer agent={agent} />
            </div>
            )
          ) : (
            <EmptyTab title="No PTY">
              {coosMode
                ? 'COOS registry agents use the Profile tab. Send messages via hive from there.'
                : 'This agent has no live terminal. Spawn an agent through "add agent" to use the terminal tab.'}
            </EmptyTab>
          )
        )}

        {sidebarTab === 'git' && (
          <GitTab cwd={agent.cwd} />
        )}

        {sidebarTab === 'messages' && (
          <div data-scroll-panel style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex' }}>
            <ThreadsPanel agentId={agent.id} />
          </div>
        )}

        {sidebarTab === 'traces' && (
          <div data-scroll-panel style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex' }}>
            {coosMode && !isReal ? (
              <CoosActivityTraces agentId={agent.id} />
            ) : (
              <ToolWaterfall agentId={agent.id} />
            )}
          </div>
        )}

        {sidebarTab === 'settings' && (
          <SettingsPanel agent={agent} />
        )}
      </div>
    </PixelPanel>
  );
}

function EmptyTab({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 16, gap: 8,
      background: 'var(--cth-paper-200)'
    }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px',
        color: 'var(--cth-ink-500)'
      }}>{title.toUpperCase()}</div>
      <p style={{
        margin: 0, fontSize: 13, textAlign: 'center', color: 'var(--cth-ink-700)',
        maxWidth: 280
      }}>{children}</p>
    </div>
  );
}

function SettingsPanel({ agent }: { agent: Agent }) {
  const updateAgent = useStore((s) => s.updateAgent);
  const getAgentAIConfig = useStore((s) => s.getAgentAIConfig);
  const setAgentAIConfig = useStore((s) => s.setAgentAIConfig);
  const config = getAgentAIConfig(agent.id) ?? {
    systemPrompt: '',
    model: agent.model ?? 'claude-sonnet-4-6',
    provider: agent.provider ?? 'claude',
    temperature: 0.7,
    maxTokens: 4096,
  };

  const handleChange = (field: keyof AgentAIConfig, value: string | number) => {
    setAgentAIConfig(agent.id, { [field]: value });
  };

  const handleAgentChange = (field: keyof Agent, value: string) => {
    updateAgent(agent.id, { [field]: value });
  };

  return (
    <div
      data-scroll-panel
      style={{
      flex: 1, overflow: 'auto', padding: 16, gap: 16,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px',
        color: 'var(--cth-ink-500)', marginBottom: 8
      }}>VISUAL APPEARANCE</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Agent Name</label>
          <input
            type="text"
            value={agent.name}
            onChange={(e) => handleAgentChange('name', e.target.value)}
            style={{
              padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
              background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
              color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Description</label>
          <input
            type="text"
            value={agent.description}
            onChange={(e) => handleAgentChange('description', e.target.value)}
            style={{
              padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
              background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
              color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Character</label>
            <select
              value={agent.character}
              onChange={(e) => handleAgentChange('character', e.target.value)}
              style={{
                padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
                background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
                color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
              }}
            >
              {['michael','jim','pam','dwight','kevin','angela','oscar','stanley',
                'phyllis','andy','kelly','ryan','toby','creed','meredith'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Accent</label>
            <select
              value={agent.accent}
              onChange={(e) => handleAgentChange('accent', e.target.value)}
              style={{
                padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
                background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
                color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
              }}
            >
              {['coral','mint','sky','lemon','lilac','peach'].map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px',
        color: 'var(--cth-ink-500)', marginTop: 16, marginBottom: 8
      }}>AI CONFIGURATION</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>System Prompt</label>
          <textarea
            value={config.systemPrompt}
            onChange={(e) => handleChange('systemPrompt', e.target.value)}
            rows={6}
            style={{
              padding: '8px 10px', fontSize: 12, fontFamily: 'var(--cth-font-mono)',
              background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
              color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4, resize: 'vertical'
            }}
            placeholder="Enter system prompt for this agent..."
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Model</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => handleChange('model', e.target.value)}
              style={{
                padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
                background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
                color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
              }}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Provider</label>
            <select
              value={config.provider}
              onChange={(e) => handleChange('provider', e.target.value)}
              style={{
                padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
                background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
                color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
              }}
            >
              {['claude','gemini','openai','ollama'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Temperature</label>
            <input
              type="number"
              value={config.temperature ?? 0.7}
              onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
              step={0.1} min={0} max={1}
              style={{
                padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
                background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
                color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
              }}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>Max Tokens</label>
            <input
              type="number"
              value={config.maxTokens ?? 4096}
              onChange={(e) => handleChange('maxTokens', parseInt(e.target.value, 10))}
              step={100} min={100} max={32000}
              style={{
                padding: '8px 10px', fontSize: 13, fontFamily: 'var(--cth-font-ui)',
                background: 'var(--cth-cream-100)', border: '1px solid var(--cth-ink-700)',
                color: 'var(--cth-ink-900)', outline: 'none', borderRadius: 4
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

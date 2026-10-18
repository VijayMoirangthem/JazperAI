import { useStore, type SidebarTab } from '@/store/store';
import { type AccentColorName } from '@/design/tokens';
import { Icon, type IconName } from './Icon';

const DESKTOP_TABS: { key: SidebarTab; label: string; icon: IconName }[] = [
  { key: 'terminal', label: 'terminal', icon: 'terminal' },
  { key: 'git', label: 'git', icon: 'code' },
  { key: 'messages', label: 'messages', icon: 'bell' },
  { key: 'traces', label: 'traces', icon: 'web' },
  { key: 'settings', label: 'settings', icon: 'gear' },
];

const COOS_TABS: { key: SidebarTab; label: string; icon: IconName }[] = [
  { key: 'profile', label: 'profile', icon: 'info' },
  { key: 'messages', label: 'messages', icon: 'bell' },
  { key: 'traces', label: 'traces', icon: 'web' },
  { key: 'settings', label: 'settings', icon: 'gear' },
];

export interface SidebarTabsProps {
  current: SidebarTab;
  accent: AccentColorName;
  onChange: (tab: SidebarTab) => void;
  coosMode?: boolean;
  hasTerminal?: boolean;
}

export function SidebarTabs({ current, accent, onChange, coosMode, hasTerminal }: SidebarTabsProps) {
  let tabs = coosMode ? COOS_TABS : DESKTOP_TABS;
  if (coosMode && hasTerminal) {
    tabs = [
      { key: 'profile', label: 'profile', icon: 'info' },
      { key: 'terminal', label: 'terminal', icon: 'terminal' },
      ...COOS_TABS.filter((t) => t.key !== 'profile'),
    ];
  }

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      background: 'var(--cth-cream-200)',
      boxShadow: 'inset 0 -2px 0 var(--cth-ink-900)',
      flexShrink: 0,
    }}>
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1,
              height: 36,
              padding: '0 8px',
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--cth-cream-100)' : 'transparent',
              boxShadow: active
                ? `inset 0 -3px 0 var(--cth-${accent}), inset 1px 0 0 var(--cth-ink-900), inset -1px 0 0 var(--cth-ink-900)`
                : 'inset 0 0 0 0',
              fontFamily: 'var(--cth-font-display)',
              fontSize: 10,
              lineHeight: '14px',
              color: active ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              minWidth: 0,
            }}
          >
            <Icon name={t.icon} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}

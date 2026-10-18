import { useStore } from '@/store/store';

const SHORTCUTS = [
  { keys: 'Wheel', action: 'Pan floor' },
  { keys: 'Ctrl + Wheel', action: 'Zoom floor (at cursor)' },
  { keys: '+ / −', action: 'Zoom in / out' },
  { keys: '0', action: 'Reset zoom' },
  { keys: 'Arrow keys', action: 'Pan floor' },
  { keys: 'F', action: 'Focus selected agent' },
  { keys: 'M', action: 'Toggle minimap' },
  { keys: '1–9', action: 'Jump to department wing' },
  { keys: 'Ctrl + K', action: 'Go-to search' },
  { keys: '?', action: 'This help overlay' },
  { keys: 'Click agent', action: 'Open employee profile' },
];

export function KeyboardHelpOverlay() {
  const open = useStore((s) => s.keyboardHelpOpen);
  const setOpen = useStore((s) => s.setKeyboardHelpOpen);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--cth-cream-100)',
          border: '2px solid var(--cth-ink-900)',
          borderRadius: 6,
          padding: 20,
          maxWidth: 420,
          width: '100%',
        }}
      >
        <div style={{
          fontFamily: 'var(--cth-font-display)',
          fontSize: 11,
          marginBottom: 12,
          color: 'var(--cth-ink-900)',
        }}>
          KEYBOARD & MOUSE
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
              <span style={{ fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-700)' }}>{s.keys}</span>
              <span style={{ color: 'var(--cth-ink-600)' }}>{s.action}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            marginTop: 16,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
            border: '1px solid var(--cth-ink-700)',
            background: 'var(--cth-paper-100)',
            borderRadius: 4,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

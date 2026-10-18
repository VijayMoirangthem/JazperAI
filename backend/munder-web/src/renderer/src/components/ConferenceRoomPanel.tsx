import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';

/** Multi-agent meeting UI — opened from the conference room on the floor. */
export function ConferenceRoomPanel() {
  const open = useStore((s) => s.conferenceOpen);
  const agentIds = useStore((s) => s.conferenceAgentIds);
  const agents = useStore((s) => s.agents);
  const close = useStore((s) => s.closeConference);
  const selectAgent = useStore((s) => s.selectAgent);

  if (!open) return null;

  const participants = agentIds
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean);

  const sendMeetingNote = async (text: string) => {
    for (const id of agentIds) {
      try {
        await fetch('/api/hive/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: id,
            subject: 'Conference meeting',
            body: text,
            act: 'inform',
          }),
        });
      } catch { /* ignore */ }
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 85,
        width: 'min(520px, 92vw)',
      }}
    >
      <PixelPanel variant="dialog" title="CONFERENCE ROOM" noPadding>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--cth-ink-600)' }}>
            {participants.length} participant{participants.length !== 1 ? 's' : ''} in session
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {participants.map((a) => a && (
              <button
                key={a.id}
                type="button"
                onClick={() => selectAgent(a.id)}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  border: '1px solid var(--cth-ink-400)',
                  borderRadius: 4,
                  background: 'var(--cth-cream-100)',
                  cursor: 'pointer',
                }}
              >
                {a.name} · {a.status}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={() => sendMeetingNote('All-hands sync — please share your current status and blockers.')}
            >
              Request status
            </PixelButton>
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={() => sendMeetingNote('Stand-down — meeting concluded. Return to your desks.')}
            >
              End meeting
            </PixelButton>
            <PixelButton variant="secondary" size="sm" onClick={close}>
              Close
            </PixelButton>
          </div>
        </div>
      </PixelPanel>
    </div>
  );
}

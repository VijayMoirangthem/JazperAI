import { Component, type ReactNode } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';

interface Props {
  children: ReactNode;
}

export class FloorErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, background: 'var(--cth-paper-200)',
        }}>
          <PixelPanel variant="dialog" title="FLOOR ERROR" style={{ maxWidth: 480 }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
              The office floor failed to render. This is usually a GPU context loss or a map load error.
            </p>
            <pre style={{
              fontSize: 11, fontFamily: 'var(--cth-font-mono)',
              background: 'var(--cth-cream-100)', padding: 8, borderRadius: 4,
              overflow: 'auto', maxHeight: 120, margin: '0 0 12px',
            }}>
              {this.state.error.message}
            </pre>
            <PixelButton variant="primary" size="sm" onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}>
              Reload floor
            </PixelButton>
          </PixelPanel>
        </div>
      );
    }
    return this.props.children;
  }
}

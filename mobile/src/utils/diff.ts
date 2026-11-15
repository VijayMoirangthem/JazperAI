export type DiffLineKind = 'add' | 'del' | 'hunk' | 'file' | 'ctx';

export function classifyLine(line: string): DiffLineKind {
  if (line.startsWith('diff --git') || line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
    return 'file';
  }
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Lines ready to draw. Header noise (index/---/+++) is dropped; a `diff --git a/x b/x` line becomes the file name. */
export function renderDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const raw of diff.split('\n')) {
    if (raw === '') continue;
    const kind = classifyLine(raw);
    if (kind === 'file') {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      if (m) out.push({ kind: 'file', text: m[2] });
      continue; // index / --- / +++ / mode lines: not useful on a phone
    }
    out.push({ kind, text: raw });
  }
  return out;
}

/** "3 files, +42 -7" */
export function changeSummary(files: number, added: number, removed: number): string {
  if (files === 0) return 'No file changes';
  return `${files} file${files === 1 ? '' : 's'}, +${added} -${removed}`;
}

export type FeatureStatusTone = 'good' | 'busy' | 'bad';

/** Plain words for a run's state, and whether it needs your attention. */
export function featureStatus(status: string | undefined, merge: string | null | undefined): { label: string; tone: FeatureStatusTone } {
  if (merge === 'merged') return { label: 'Merged', tone: 'good' };
  if (merge === 'awaiting-approval') return { label: 'Waiting for your approval', tone: 'busy' };
  if (merge === 'denied') return { label: 'Merge declined', tone: 'bad' };
  if (merge === 'error') return { label: 'Merge failed', tone: 'bad' };
  switch (status) {
    case 'verified':
      return { label: 'Tests passed, ready to merge', tone: 'good' };
    case 'failed':
    case 'rolled_back_escalated':
      return { label: 'Could not be completed', tone: 'bad' };
    case 'running':
    case 'planning':
    case 'working':
    case 'testing':
      return { label: 'In progress', tone: 'busy' };
    default:
      return { label: status ? status.replace(/_/g, ' ') : 'Unknown', tone: 'busy' };
  }
}

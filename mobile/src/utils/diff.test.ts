import { changeSummary, classifyLine, featureStatus, renderDiff } from './diff';

const DIFF = [
  'diff --git a/calc.py b/calc.py',
  'index 111..222 100644',
  '--- a/calc.py',
  '+++ b/calc.py',
  '@@ -1,2 +1,3 @@',
  ' def add(a, b):',
  '-    return a - b',
  '+    return a + b',
].join('\n');

describe('diff helpers', () => {
  it('classifies lines', () => {
    expect(classifyLine('+added')).toBe('add');
    expect(classifyLine('-removed')).toBe('del');
    expect(classifyLine('@@ -1 +1 @@')).toBe('hunk');
    expect(classifyLine('+++ b/x')).toBe('file');
    expect(classifyLine('--- a/x')).toBe('file');
    expect(classifyLine(' context')).toBe('ctx');
  });

  it('renders a diff without header noise and with the file name', () => {
    expect(renderDiff(DIFF)).toEqual([
      { kind: 'file', text: 'calc.py' },
      { kind: 'hunk', text: '@@ -1,2 +1,3 @@' },
      { kind: 'ctx', text: ' def add(a, b):' },
      { kind: 'del', text: '-    return a - b' },
      { kind: 'add', text: '+    return a + b' },
    ]);
    expect(renderDiff('')).toEqual([]);
  });

  it('summarises the size of a change', () => {
    expect(changeSummary(0, 0, 0)).toBe('No file changes');
    expect(changeSummary(1, 3, 1)).toBe('1 file, +3 -1');
    expect(changeSummary(4, 42, 7)).toBe('4 files, +42 -7');
  });

  it('says in plain words what state a run is in', () => {
    expect(featureStatus('verified', null)).toEqual({ label: 'Tests passed, ready to merge', tone: 'good' });
    expect(featureStatus('verified', 'awaiting-approval').label).toBe('Waiting for your approval');
    expect(featureStatus('verified', 'merged')).toEqual({ label: 'Merged', tone: 'good' });
    expect(featureStatus('verified', 'denied').tone).toBe('bad');
    expect(featureStatus('rolled_back_escalated', null).tone).toBe('bad');
    expect(featureStatus('running', null).tone).toBe('busy');
    expect(featureStatus(undefined, null).label).toBe('Unknown');
  });
});

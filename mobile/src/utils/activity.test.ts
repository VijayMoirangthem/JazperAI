import { formatBudget, isMonospaceKind, statusLabel, threadTitle } from './activity';

describe('activity helpers', () => {
  it('titles a thread as from -> to', () => {
    expect(threadTitle('jasper', 'messenger')).toBe('jasper \u2192 messenger');
  });

  it('labels every SLO status', () => {
    expect(statusLabel('ok')).toBe('OK');
    expect(statusLabel('breached')).toBe('Breached');
    expect(statusLabel('no-data')).toBe('No data');
  });

  it('formats the remaining error budget as a percentage', () => {
    expect(formatBudget(0.624)).toBe('62% remaining');
    expect(formatBudget(1)).toBe('100% remaining');
    expect(formatBudget(-0.5)).toBe('-50% remaining');
  });

  it('shows no data when the budget is unknown', () => {
    expect(formatBudget(null)).toBe('No data');
  });

  it('uses monospace styles for tool and result messages only', () => {
    expect(isMonospaceKind('tool')).toBe(true);
    expect(isMonospaceKind('result')).toBe(true);
    expect(isMonospaceKind('ask')).toBe(false);
    expect(isMonospaceKind('reply')).toBe(false);
    expect(isMonospaceKind('message')).toBe(false);
    expect(isMonospaceKind('conclusion')).toBe(false);
  });
});

import { SilenceDetector } from './silence';

// Plays a level pattern, one sample every 100 ms, and returns the first non-listening verdict with its time.
function run(det: SilenceDetector, levels: number[]): { verdict: string; at: number } {
  for (let i = 0; i < levels.length; i += 1) {
    const v = det.update(levels[i], i * 100);
    if (v !== 'listening') return { verdict: v, at: i * 100 };
  }
  return { verdict: 'listening', at: levels.length * 100 };
}
const rep = (level: number, n: number) => Array<number>(n).fill(level);

describe('SilenceDetector', () => {
  it('ends the recording after a pause that follows real speech', () => {
    const r = run(new SilenceDetector(), [...rep(0.1, 3), ...rep(0.6, 20), ...rep(0.1, 30)]);
    expect(r.verdict).toBe('stop-silence');
    expect(r.at).toBeGreaterThanOrEqual(2300 + 1300 - 100);     // speech ended at 2.3 s, plus the 1.3 s pause
    expect(r.at).toBeLessThanOrEqual(2300 + 1300 + 200);
  });

  it('does not stop in the middle of a sentence (short dips are not the end)', () => {
    const levels = [...rep(0.6, 10), ...rep(0.15, 5), ...rep(0.6, 10), ...rep(0.15, 5), ...rep(0.6, 10)];   // 0.5 s dips
    expect(run(new SilenceDetector(), levels).verdict).toBe('listening');
  });

  it('gives up when nobody speaks, so a hands-free loop never holds the microphone open', () => {
    const r = run(new SilenceDetector(), rep(0.08, 200));
    expect(r.verdict).toBe('stop-no-speech');
    expect(r.at).toBe(8000);
  });

  it('a click or cough is not speech', () => {
    const r = run(new SilenceDetector(), [...rep(0.05, 5), 0.9, ...rep(0.05, 100)]);
    expect(r.verdict).toBe('stop-no-speech');
  });

  it('never records longer than the hard limit, even while someone keeps talking', () => {
    const r = run(new SilenceDetector({ maxMs: 5000 }), rep(0.7, 200));
    expect(r.verdict).toBe('stop-max');
    expect(r.at).toBe(5000);
  });

  it('waiting for the first words does not count as a pause', () => {
    const r = run(new SilenceDetector(), [...rep(0.05, 60), ...rep(0.6, 8), ...rep(0.05, 20)]);       // 6 s of quiet, then speech
    expect(r.verdict).toBe('stop-silence');
  });

  it('reports whether real speech was heard', () => {
    const det = new SilenceDetector();
    run(det, rep(0.05, 20));
    expect(det.heardSpeech).toBe(false);
    run(det, rep(0.6, 10));
    expect(det.heardSpeech).toBe(true);
  });
});

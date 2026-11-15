import { SpeechPipeline, type PipelineDeps } from './pipeline';

type Gate = { promise: Promise<void>; open: () => void };
const gate = (): Gate => {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
};
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function rig(over: Partial<PipelineDeps<string>> = {}) {
  const log: string[] = [];
  const playGates: Record<string, Gate> = {};
  const deps: PipelineDeps<string> = {
    fetch: async (t) => {
      log.push(`fetch:${t}`);
      return `file-${t}`;
    },
    play: async (f, onStart, signal) => {
      log.push(`play:${f}`);
      onStart();
      playGates[f] = playGates[f] ?? gate();
      await Promise.race([playGates[f].promise, signal.stopped]);
      log.push(`end:${f}`);
    },
    discard: (f) => void log.push(`discard:${f}`),
    ...over,
  };
  return { log, deps, playGates, finish: (f: string) => (playGates[f] = playGates[f] ?? gate()).open() };
}

describe('SpeechPipeline', () => {
  it('plays chunks in order and discards each file', async () => {
    const { deps, log, finish } = rig();
    const p = new SpeechPipeline(deps);
    p.push('a');
    p.push('b');
    p.close();
    finish('file-a');
    finish('file-b');
    await p.done;
    expect(log.filter((l) => l.startsWith('play:') || l.startsWith('end:'))).toEqual(['play:file-a', 'end:file-a', 'play:file-b', 'end:file-b']);
    expect(log).toContain('discard:file-a');
    expect(log).toContain('discard:file-b');
  });

  it('downloads the next chunk while the current one is still playing (no gap)', async () => {
    const { deps, log, finish } = rig();
    const p = new SpeechPipeline(deps);
    p.push('a');
    p.push('b');
    await tick();
    await tick();
    expect(log).toContain('play:file-a');
    expect(log).toContain('fetch:b');                  // already fetched although 'a' has not finished
    expect(log).not.toContain('play:file-b');
    p.close();
    finish('file-a');
    finish('file-b');
    await p.done;
  });

  it('accepts chunks that arrive while it is already playing, and finishes only after close()', async () => {
    const { deps, log, finish } = rig();
    const p = new SpeechPipeline(deps);
    p.push('a');
    await tick();
    finish('file-a');
    await tick();
    await tick();
    expect(log).toContain('end:file-a');
    let ended = false;
    void p.done.then(() => (ended = true));
    await tick();
    expect(ended).toBe(false);                          // waiting for more text, not finished
    p.push('late');
    finish('file-late');
    p.close();
    await p.done;
    expect(log).toContain('play:file-late');
  });

  it('limits how far ahead it downloads', async () => {
    const { deps, log } = rig();
    const p = new SpeechPipeline(deps, 2);
    ['a', 'b', 'c', 'd', 'e'].forEach((t) => p.push(t));
    await tick();
    await tick();
    expect(log.filter((l) => l.startsWith('fetch:')).length).toBeLessThanOrEqual(3);   // 1 playing + 2 ahead
    p.stop();
    await p.done;
  });

  it('stop() ends it at once and throws away files that were never played', async () => {
    const { deps, log } = rig();
    const p = new SpeechPipeline(deps);
    p.push('a');
    p.push('b');
    await tick();
    await tick();
    p.stop();
    await p.done;                                       // ends at once: the playing chunk is cut off by the stop signal
    expect(log).toContain('end:file-a');
    expect(log).not.toContain('play:file-b');
    await tick();
    expect(log).toContain('discard:file-b');          // downloaded but never played: thrown away
  });

  it('a failed download rejects done and stops further playback', async () => {
    const { deps, log } = rig({
      fetch: async (t) => {
        if (t === 'bad') throw new Error('speech service unavailable');
        return `file-${t}`;
      },
    });
    const p = new SpeechPipeline(deps);
    p.push('bad');
    p.push('after');
    p.close();
    await expect(p.done).rejects.toThrow('speech service unavailable');
    expect(log).not.toContain('play:file-after');
  });

  it('ignores empty text and pushes after close()', async () => {
    const { deps, log } = rig();
    const p = new SpeechPipeline(deps);
    p.push('   ');
    p.close();
    p.push('too late');
    await p.done;
    expect(log).toEqual([]);
  });

  it('reports the first sound once', async () => {
    const first = jest.fn();
    const { deps, finish } = rig({ onFirstSound: first });
    const p = new SpeechPipeline(deps);
    p.push('a');
    p.push('b');
    p.close();
    finish('file-a');
    finish('file-b');
    await p.done;
    expect(first).toHaveBeenCalledTimes(1);
  });
});

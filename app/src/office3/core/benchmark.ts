export type FrameBenchmarkSample = { frameMs: number; calls: number; triangles: number; people: number; heapMb: number | null };
export type FrameBenchmarkResult = { elapsedMs: number; samples: number; fpsMedian: number; fpsP95: number; fpsP99: number; frameP50Ms: number; frameP95Ms: number; frameP99Ms: number; calls: number; triangles: number; people: number; heapMb: number | null };

const percentile = (values: readonly number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
};

/** Lightweight browser-side collector used by #office3?bench=1 and future e2e gates. */
export const createFrameBenchmark = () => {
  const frames: number[] = [];
  let latest: Omit<FrameBenchmarkSample, "frameMs"> = { calls: 0, triangles: 0, people: 0, heapMb: null };
  const startedAt = performance.now();
  return {
    sample(sample: FrameBenchmarkSample) { if (Number.isFinite(sample.frameMs) && sample.frameMs > 0) frames.push(sample.frameMs); latest = { calls: sample.calls, triangles: sample.triangles, people: sample.people, heapMb: sample.heapMb }; },
    result(): FrameBenchmarkResult {
      const p50 = percentile(frames, .5), p95 = percentile(frames, .95), p99 = percentile(frames, .99);
      return { elapsedMs: Math.round(performance.now() - startedAt), samples: frames.length, fpsMedian: p50 ? Math.round(1000 / p50 * 10) / 10 : 0, fpsP95: p95 ? Math.round(1000 / p95 * 10) / 10 : 0, fpsP99: p99 ? Math.round(1000 / p99 * 10) / 10 : 0, frameP50Ms: Math.round(p50 * 100) / 100, frameP95Ms: Math.round(p95 * 100) / 100, frameP99Ms: Math.round(p99 * 100) / 100, ...latest };
    },
  };
};

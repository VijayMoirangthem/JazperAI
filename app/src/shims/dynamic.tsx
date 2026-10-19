import { Suspense, lazy, type ComponentType } from "react";

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

/** Minimal stand-in for next/dynamic: lazy chunk + Suspense. `ssr` and `loading` options are accepted and ignored. */
export default function dynamic<P extends object>(loader: Loader<P>, opts?: { ssr?: boolean; loading?: () => JSX.Element | null }) {
  const Lazy = lazy(async () => {
    const m = await loader();
    return "default" in (m as object) ? (m as { default: ComponentType<P> }) : { default: m as ComponentType<P> };
  });
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={opts?.loading ? opts.loading() : null}>
        <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  };
}

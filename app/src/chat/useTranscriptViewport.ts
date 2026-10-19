import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const WINDOW = 200;
const NEAR_BOTTOM_PX = 80;

/**
 * Bottom-follow scroll + tail windowing (pattern: OpenMausBot use-transcript-viewport).
 * Following breaks only on an upward user gesture (content growth momentarily reads "not at bottom"),
 * resumes when the user scrolls back near the bottom. Only the last WINDOW messages render until "show earlier".
 */
export function useTranscriptViewport(count: number, channel: string, bump: unknown): {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onWheel: (e: { deltaY: number }) => void;
  following: boolean;
  jumpToBottom: () => void;
  start: number;
  showEarlier: () => void;
} {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const followRef = useRef(true);
  const lastTop = useRef(0);
  const [extra, setExtra] = useState({ channel, n: 0 });
  const grown = extra.channel === channel ? extra.n : 0;

  const setFollow = (v: boolean) => { followRef.current = v; setFollowing(v); };
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollow(true);
  }, []);

  useLayoutEffect(() => { if (followRef.current) { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; } }, [count, bump]);
  useEffect(() => { setFollow(true); const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [channel]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop < lastTop.current - 2 && !nearBottom) setFollow(false); // upward gesture
    else if (nearBottom && !followRef.current) setFollow(true);
    lastTop.current = el.scrollTop;
  };
  const onWheel = (e: { deltaY: number }) => { if (e.deltaY < 0) setFollow(false); };

  return {
    scrollRef, onScroll, onWheel, following, jumpToBottom,
    start: Math.max(0, count - WINDOW - grown),
    showEarlier: () => setExtra({ channel, n: grown + WINDOW }),
  };
}

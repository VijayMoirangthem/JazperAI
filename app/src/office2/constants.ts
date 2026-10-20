export const T = 32;
/** Draw order bands. Avatars use their own y as depth (perspective), which is always below `overlay`. */
export const DEPTH = { tiles: 0, overlay: 1_000_000, halo: 1_050_000, tags: 1_100_000, ui: 1_200_000 } as const;

/** Query part of the panel hash: "#office2?bots=40&gather=lounge" -> URLSearchParams. */
export function hashParams(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf("?");
  return new URLSearchParams(i < 0 ? "" : h.slice(i + 1));
}

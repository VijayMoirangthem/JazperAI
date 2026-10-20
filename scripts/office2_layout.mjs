// Layout data for the Office 2 map (tile units, inclusive rectangles). Pure data: scripts/gen_office2_map.mjs paints it, tests verify it.
export const W = 60, H = 40;

// Rectangles [x1, y1, x2, y2] painted as wall: outer ring and room dividers.
export const WALLS = [
  [0, 0, 59, 0], [0, 39, 59, 39], [0, 0, 0, 39], [59, 0, 59, 39],
  [1, 14, 58, 14], [1, 18, 58, 18],
  [22, 1, 22, 13], [44, 1, 44, 13],
  [19, 19, 19, 38], [38, 19, 38, 38],
  [1, 28, 37, 28],
];
// Door tiles: wall tiles turned back into floor (always 2 tiles wide).
export const DOORS = [
  [10, 14], [11, 14], [33, 14], [34, 14], [51, 14], [52, 14],
  [22, 6], [22, 7], [44, 6], [44, 7],
  [9, 18], [10, 18], [28, 18], [29, 18], [48, 18], [49, 18],
  [19, 22], [19, 23], [38, 22], [38, 23],
  [9, 28], [10, 28], [28, 28], [29, 28],
  [38, 33], [38, 34],
];

// Rooms. rect = interior floor. floor = floor tile name from scripts/office2_tiles.mjs
export const AREAS = [
  { room: "engineering", label: "Engineering", kind: "work", rect: [1, 1, 21, 13], focusable: true, floor: "carpet_blue" },
  { room: "operations", label: "Operations", kind: "work", rect: [23, 1, 43, 13], focusable: true, floor: "carpet_green" },
  { room: "founder", label: "Founder office", kind: "private", rect: [45, 1, 58, 13], focusable: true, floor: "wood_a" },
  { room: "corridor", label: "Corridor", kind: "transit", rect: [1, 15, 58, 17], focusable: false, floor: "tile_light" },
  { room: "meeting", label: "Meeting room", kind: "meet", rect: [1, 19, 18, 27], focusable: true, floor: "carpet_purple" },
  { room: "tools", label: "Tools lab", kind: "tools", rect: [20, 19, 37, 27], focusable: true, floor: "tile_dark" },
  { room: "lounge", label: "Lounge", kind: "social", rect: [39, 19, 58, 38], focusable: true, floor: "wood_b" },
  { room: "server", label: "Server room", kind: "tools", rect: [1, 29, 18, 38], focusable: true, floor: "stone" },
  { room: "reception", label: "Reception", kind: "social", rect: [20, 29, 37, 38], focusable: true, floor: "tile_light" },
];

// Blocking furniture. One tile unless w/h are given (then a w x h block of that type).
export const FURNITURE = [
  ...[3, 7, 11, 15, 19].flatMap((x) => [3, 7, 11].map((y) => ({ type: "desk", x, y }))),
  ...[25, 29, 33, 37, 41].flatMap((x) => [3, 7, 11].map((y) => ({ type: "desk", x, y }))),
  { type: "desk", x: 52, y: 3 },
  { type: "bookshelf", x: 47, y: 1, w: 4, h: 1 }, { type: "bookshelf", x: 55, y: 1, w: 3, h: 1 },
  { type: "table", x: 6, y: 22, w: 8, h: 3 },
  ...[23, 27, 31, 35].flatMap((x) => [21, 25].map((y) => ({ type: "machine", x, y }))),
  ...[3, 5, 7, 9, 11, 13, 15, 17].map((x) => ({ type: "rack", x, y: 30 })),
  { type: "reception_desk", x: 27, y: 32, w: 4, h: 1 },
  { type: "sofa", x: 42, y: 23, w: 3, h: 1 }, { type: "sofa", x: 50, y: 23, w: 3, h: 1 },
  { type: "sofa", x: 42, y: 33, w: 3, h: 1 }, { type: "sofa", x: 50, y: 33, w: 3, h: 1 },
  { type: "vending", x: 57, y: 20 },
  ...[[2, 2], [21, 2], [24, 2], [43, 2], [46, 12], [57, 12], [2, 20], [18, 20], [21, 20], [36, 20], [40, 20], [57, 36], [40, 36], [21, 36], [36, 36], [2, 36]]
    .map(([x, y]) => ({ type: "plant", x, y })),
];

// Spots: "seat" = desk chair, "spot" = place to stand/sit. slot = stable order inside a room.
const seatsFor = (xs, room) => xs.flatMap((x, i) => [4, 8, 12].map((y, j) => ({ type: "seat", room, x, y, facing: "up", slot: i * 3 + j })));
export const SPOTS = [
  ...seatsFor([3, 7, 11, 15, 19], "engineering"),
  ...seatsFor([25, 29, 33, 37, 41], "operations"),
  { type: "seat", room: "founder", x: 52, y: 4, facing: "up", slot: 0 },
  { type: "spot", room: "founder", x: 50, y: 12, slot: 1 }, { type: "spot", room: "founder", x: 53, y: 12, slot: 2 },
  { type: "spot", room: "founder", x: 48, y: 8, slot: 3 }, { type: "spot", room: "founder", x: 55, y: 8, slot: 4 },
  ...[5, 7, 9, 11, 13].flatMap((x, i) => [{ type: "spot", room: "meeting", x, y: 21, facing: "down", slot: i }, { type: "spot", room: "meeting", x, y: 25, facing: "up", slot: 5 + i }]),
  { type: "spot", room: "meeting", x: 4, y: 23, facing: "right", slot: 10 }, { type: "spot", room: "meeting", x: 15, y: 23, facing: "left", slot: 11 },
  ...[23, 27, 31, 35].flatMap((x, i) => [{ type: "spot", room: "tools", x, y: 22, facing: "up", slot: i }, { type: "spot", room: "tools", x, y: 26, facing: "up", slot: 4 + i }]),
  ...[41, 45, 49, 53, 56].flatMap((x, i) => [21, 25, 31, 35].map((y, j) => ({ type: "spot", room: "lounge", x, y, slot: i * 4 + j }))),
  ...[24, 26, 32, 34, 22, 36].map((x, i) => ({ type: "spot", room: "reception", x, y: i < 4 ? 34 : 31, slot: i })),
  ...[4, 8, 12, 16].map((x, i) => ({ type: "spot", room: "server", x, y: 33, slot: i })),
  ...[3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 57].map((x, i) => ({ type: "spot", room: "corridor", x, y: 16, slot: i })),
];
export const START = [52, 9];

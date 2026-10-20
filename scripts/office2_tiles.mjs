// Tile ids shared by gen_office2_tiles.mjs (draws them) and gen_office2_map.mjs (places them). Tileset image: 16 columns x 8 rows of 32 px; id = row * 16 + column + 1.
export const TILE_SIZE = 32;
export const TILE = {
  wood_a: 1, wood_b: 2, carpet_blue: 3, carpet_purple: 4, carpet_green: 5, tile_light: 6, tile_dark: 7, stone: 8,
  wall_cap: 16, wall_face: 17,
  desk_a: 32, desk_b: 33, bookshelf: 34, table: 35, machine: 36, rack: 37, reception_desk: 38, sofa: 39, vending: 40, plant: 41,
  chair: 64,
  plant_top: 96,
};
/** Furniture type (layout file) -> tile id. "desk" alternates desk_a/desk_b in the map generator. */
export const FURNITURE_TILE = {
  bookshelf: TILE.bookshelf, table: TILE.table, machine: TILE.machine, rack: TILE.rack,
  reception_desk: TILE.reception_desk, sofa: TILE.sofa, vending: TILE.vending, plant: TILE.plant,
};

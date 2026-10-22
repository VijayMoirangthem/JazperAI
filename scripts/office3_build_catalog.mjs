import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const categories = {
  Workstations: ["desk", "standing-desk", "workbench", "terminal", "cabinet", "monitor", "laptop", "divider"],
  Seating: ["task-chair", "stool", "armchair", "bench", "beanbag", "dining-chair", "high-chair", "ottoman"],
  Tables: ["round-table", "long-table", "side-table", "coffee-table", "console", "island", "drafting-table", "folding-table"],
  Meeting: ["conference-table", "whiteboard", "screen", "lectern", "meeting-chair", "video-bar", "task-board", "planner"],
  Storage: ["shelf", "locker", "bookcase", "filing", "crate", "drawer", "archive", "display"],
  Tech: ["server-rack", "hardware-bench", "phone-booth", "router", "printer", "scanner", "charging-station", "camera"],
  Lounge: ["sofa", "rug", "plant", "lamp", "cushion", "bar-cart", "reading-chair", "media-console"],
  Appliances: ["coffee-machine", "vending-machine", "water-cooler", "fridge", "microwave", "sink", "kettle", "reception"],
};
const catalogue = Object.entries(categories).flatMap(([category, names]) => names.map((name, index) => ({
  id: `${category.toLowerCase().replaceAll(" ", "-")}-${name}-v1`, name: name.replaceAll("-", " "), category,
  tags: [category.toLowerCase(), name], file: null, footprint: [index % 3 === 0 ? 2 : 1, index % 4 === 0 ? 2 : 1],
  height: 1, anchor: [0, 0, 0], rotSteps: 4, snap: "grid", blocks: !["rug", "plant", "lamp", "screen"].includes(name),
  seats: /chair|sofa|bench|beanbag|stool|ottoman/.test(name) ? [{ pos: [0, 0], facing: "up" }] : [], interact: [], placeholder: true,
})));
const out = resolve("app/public/office3/catalog.json");
await mkdir(resolve("app/public/office3"), { recursive: true });
await writeFile(out, JSON.stringify(catalogue, null, 2));
console.log(`built ${catalogue.length} Office 3 prefabs`);

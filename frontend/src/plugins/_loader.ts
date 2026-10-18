// AUTO-GENERATED — do not edit manually. Updated by the backend file watcher.
// To add a new plugin: drop a .tsx file in this directory with `export const pluginMeta = {...}`
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const PLUGINS: Record<string, ComponentType> = {
  example: dynamic(() => import("./ExamplePlugin"), { ssr: false }),
  // [PLUGIN_LOADER_ENTRIES]
};

export default PLUGINS;

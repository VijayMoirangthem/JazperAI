export interface Shortcut { id: string; keys: string; label: string }
export const DEFAULT_SHORTCUTS: readonly Shortcut[] = [{id:"palette",keys:"Ctrl+K",label:"Command palette"},{id:"help",keys:"?",label:"Help"},{id:"clear-selection",keys:"Esc",label:"Clear selection"},{id:"camera-home",keys:"Home",label:"Camera home"},{id:"view-cycle",keys:"T",label:"Cycle view"}];
export const normaliseShortcut=(keys:string):string=>keys.toLowerCase().replace(/\s+/g,"");
export const findShortcutConflicts=(shortcuts:readonly Shortcut[]):string[]=>{const seen=new Set<string>(), conflicts:string[]=[];for(const shortcut of shortcuts){const key=normaliseShortcut(shortcut.keys);if(seen.has(key))conflicts.push(shortcut.id);seen.add(key)}return conflicts};

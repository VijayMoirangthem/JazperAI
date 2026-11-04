import type { OfficeActor } from "../engine/actors";
import { actionsFor, type ActionContext } from "../core/actions";
export type ContextActionHandler = (action: string, actor: OfficeActor) => void;
export type FloorContextActionHandler = (action: string, tile: [number, number]) => void;
export type ObjectContextActionHandler = (action: string, id: string) => void;
export type RoomContextActionHandler = (action: string, id: string) => void;
const bindMenuKeys = (menu: HTMLDivElement) => menu.addEventListener("keydown", event => {
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  if (!buttons.length) return;
  const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const index = activeIndex < 0 ? (event.key === "ArrowDown" ? -1 : 0) : activeIndex; buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus(); }
  else if (event.key === "Home") { event.preventDefault(); buttons[0].focus(); }
  else if (event.key === "End") { event.preventDefault(); buttons[buttons.length - 1].focus(); }
});
export const openContextMenu = (host: HTMLElement, actor: OfficeActor, x: number, y: number, onAction: ContextActionHandler) => {
  host.querySelector("[data-office3-context]")?.remove();
  const conversation = actor.root.userData.office3Conversation as string[] | undefined;
  const context: ActionContext = { target: "actor", role: "founder", state: actor.state, isSelf: actor.person.kind === "human", isAgent: actor.person.kind !== "human", canDismissCall: Array.isArray(actor.root.userData.office3CallOrigin), canLockConversation: Array.isArray(conversation) && conversation.length > 1, conversationLocked: Boolean(actor.root.userData.office3ConversationLocked), following: Boolean(actor.root.userData.office3Following) };
  const menu = document.createElement("div");
  menu.dataset.office3Context = "";
  menu.tabIndex = 0;
  menu.setAttribute("role", "menu");
  menu.style.cssText = "position:absolute;z-index:20;min-width:142px;left:" + Math.max(4, Math.min(x, host.clientWidth - 150)) + "px;top:" + Math.max(4, Math.min(y, host.clientHeight - 230)) + "px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;padding:6px;font:12px system-ui;box-shadow:0 8px 28px #0008";
  const title = document.createElement("strong"); title.textContent = actor.person.name; title.style.display = "block"; title.style.padding = "3px 4px 5px"; menu.append(title);
  for (const action of actionsFor(context)) { const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.dataset.action = action.id; button.setAttribute("role", "menuitem"); button.style.cssText = "display:block;text-align:left;width:100%;margin-top:3px;background:#1e293b;border:0;border-radius:4px;color:#fff;padding:5px 7px;cursor:pointer"; button.onclick = () => { onAction(action.id, actor); menu.remove(); }; menu.append(button); }
  bindMenuKeys(menu);
  const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { menu.remove(); window.removeEventListener("keydown", dismiss); } };
  window.addEventListener("keydown", dismiss); menu.addEventListener("blur", () => window.setTimeout(() => menu.remove(), 120)); host.append(menu); menu.focus();
};

/** Opens the declared floor actions at a world tile rather than silently treating every right-click as actor-only. */
export const openFloorContextMenu = (host: HTMLElement, tile: [number, number], x: number, y: number, onAction: FloorContextActionHandler) => {
  host.querySelector("[data-office3-context]")?.remove();
  const context: ActionContext = { target: "floor", role: "founder" };
  const menu = document.createElement("div");
  menu.dataset.office3Context = "";
  menu.tabIndex = 0;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Floor tile ${tile[0] + 1}, ${tile[1] + 1}`);
  menu.style.cssText = "position:absolute;z-index:20;min-width:142px;left:" + Math.max(4, Math.min(x, host.clientWidth - 150)) + "px;top:" + Math.max(4, Math.min(y, host.clientHeight - 150)) + "px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;padding:6px;font:12px system-ui;box-shadow:0 8px 28px #0008";
  const title = document.createElement("strong"); title.textContent = `Tile ${tile[0] + 1}, ${tile[1] + 1}`; title.style.cssText = "display:block;padding:3px 4px 5px"; menu.append(title);
  for (const action of actionsFor(context)) { const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.dataset.action = action.id; button.setAttribute("role", "menuitem"); button.style.cssText = "display:block;text-align:left;width:100%;margin-top:3px;background:#1e293b;border:0;border-radius:4px;color:#fff;padding:5px 7px;cursor:pointer"; button.onclick = () => { onAction(action.id, tile); menu.remove(); }; menu.append(button); }
  bindMenuKeys(menu);
  const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { menu.remove(); window.removeEventListener("keydown", dismiss); } };
  window.addEventListener("keydown", dismiss); menu.addEventListener("blur", () => window.setTimeout(() => menu.remove(), 120)); host.append(menu); menu.focus();
};

export const openObjectContextMenu = (host: HTMLElement, object: { id: string; prefab: string; pos: [number, number]; interactable?: boolean }, x: number, y: number, onAction: ObjectContextActionHandler) => {
  host.querySelector("[data-office3-context]")?.remove();
  // Edit mutations remain in Builder's persisted inspector. The scene menu is a
  // read-only, safe entrypoint for the object action that works in every mode.
  const context: ActionContext = { target: "object", role: "founder", editMode: false, interactable: object.interactable };
  const menu = document.createElement("div");
  menu.dataset.office3Context = ""; menu.tabIndex = 0; menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Object ${object.prefab}`);
  menu.style.cssText = "position:absolute;z-index:20;min-width:162px;left:" + Math.max(4, Math.min(x, host.clientWidth - 170)) + "px;top:" + Math.max(4, Math.min(y, host.clientHeight - 150)) + "px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;padding:6px;font:12px system-ui;box-shadow:0 8px 28px #0008";
  const title = document.createElement("strong"); title.textContent = object.prefab; title.style.cssText = "display:block;padding:3px 4px 1px"; menu.append(title);
  const meta = document.createElement("span"); meta.textContent = `Tile ${object.pos[0] + 1}, ${object.pos[1] + 1}`; meta.style.cssText = "display:block;padding:0 4px 5px;color:#94a3b8;font-size:11px"; menu.append(meta);
  for (const action of actionsFor(context)) { const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.dataset.action = action.id; button.setAttribute("role", "menuitem"); button.style.cssText = "display:block;text-align:left;width:100%;margin-top:3px;background:#1e293b;border:0;border-radius:4px;color:#fff;padding:5px 7px;cursor:pointer"; button.onclick = () => { onAction(action.id, object.id); menu.remove(); }; menu.append(button); }
  bindMenuKeys(menu);
  const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { menu.remove(); window.removeEventListener("keydown", dismiss); } };
  window.addEventListener("keydown", dismiss); menu.addEventListener("blur", () => window.setTimeout(() => menu.remove(), 120)); host.append(menu); menu.focus();
};

export const openRoomContextMenu = (host: HTMLElement, room: { id: string; label: string; rect: [number, number, number, number] }, x: number, y: number, onAction: RoomContextActionHandler) => {
  host.querySelector("[data-office3-context]")?.remove();
  const context: ActionContext = { target: "room", role: "founder" };
  const menu = document.createElement("div");
  menu.dataset.office3Context = ""; menu.tabIndex = 0; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", `Room ${room.label}`);
  menu.style.cssText = "position:absolute;z-index:20;min-width:174px;left:" + Math.max(4, Math.min(x, host.clientWidth - 182)) + "px;top:" + Math.max(4, Math.min(y, host.clientHeight - 150)) + "px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;padding:6px;font:12px system-ui;box-shadow:0 8px 28px #0008";
  const title = document.createElement("strong"); title.textContent = room.label; title.style.cssText = "display:block;padding:3px 4px 5px"; menu.append(title);
  for (const action of actionsFor(context)) { const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.dataset.action = action.id; button.setAttribute("role", "menuitem"); button.style.cssText = "display:block;text-align:left;width:100%;margin-top:3px;background:#1e293b;border:0;border-radius:4px;color:#fff;padding:5px 7px;cursor:pointer"; button.onclick = () => { onAction(action.id, room.id); menu.remove(); }; menu.append(button); }
  bindMenuKeys(menu);
  const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { menu.remove(); window.removeEventListener("keydown", dismiss); } };
  window.addEventListener("keydown", dismiss); menu.addEventListener("blur", () => window.setTimeout(() => menu.remove(), 120)); host.append(menu); menu.focus();
};

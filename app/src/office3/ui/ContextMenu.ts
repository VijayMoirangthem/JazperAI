import type { OfficeActor } from "../engine/actors";
import { actionsFor, type ActionContext } from "../core/actions";
export type ContextActionHandler = (action: string, actor: OfficeActor) => void;
export const openContextMenu = (host: HTMLElement, actor: OfficeActor, x: number, y: number, onAction: ContextActionHandler) => {
  host.querySelector("[data-office3-context]")?.remove();
  const context: ActionContext = { target: "actor", role: "founder", state: actor.state, isAgent: actor.person.kind !== "human" };
  const menu = document.createElement("div");
  menu.dataset.office3Context = "";
  menu.tabIndex = 0;
  menu.setAttribute("role", "menu");
  menu.style.cssText = "position:absolute;z-index:20;min-width:142px;left:" + Math.max(4, Math.min(x, host.clientWidth - 150)) + "px;top:" + Math.max(4, Math.min(y, host.clientHeight - 230)) + "px;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:8px;padding:6px;font:12px system-ui;box-shadow:0 8px 28px #0008";
  const title = document.createElement("strong"); title.textContent = actor.person.name; title.style.display = "block"; title.style.padding = "3px 4px 5px"; menu.append(title);
  for (const action of actionsFor(context)) { const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.dataset.action = action.id; button.setAttribute("role", "menuitem"); button.style.cssText = "display:block;text-align:left;width:100%;margin-top:3px;background:#1e293b;border:0;border-radius:4px;color:#fff;padding:5px 7px;cursor:pointer"; button.onclick = () => { onAction(action.id, actor); menu.remove(); }; menu.append(button); }
  const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { menu.remove(); window.removeEventListener("keydown", dismiss); } };
  window.addEventListener("keydown", dismiss); menu.addEventListener("blur", () => window.setTimeout(() => menu.remove(), 120)); host.append(menu); menu.focus();
};

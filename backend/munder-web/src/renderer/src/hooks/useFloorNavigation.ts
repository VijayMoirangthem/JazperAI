import { useEffect, useRef } from 'react';
import { useStore } from '@/store/store';
import type { DepartmentZone } from '@/store/store';

const FLOOR_SELECTOR = '[data-floor-canvas]';

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el.isContentEditable) return true;
  // Scrollable panels — let native scroll work
  if (el.closest('[data-scroll-panel]')) return true;
  return false;
}

/** Keyboard + mouse wheel navigation scoped to the floor canvas only. */
export function useFloorNavigation(
  camera: {
    zoomIn: (anchor?: { x: number; y: number }) => void;
    zoomOut: (anchor?: { x: number; y: number }) => void;
    resetZoom: () => void;
    panTo: (x: number, y: number, duration?: number) => void;
    panBy: (dx: number, dy: number) => void;
    focusOnZone: (zoneX: number, zoneY: number, zoom?: number) => void;
    focusOnAgent: (agentX: number, agentY: number) => void;
    getZoom: () => number;
    getVisibleBounds: () => { x: number; y: number; width: number; height: number };
    isAnimating: () => boolean;
    focusSelected?: () => void;
    handleWheel?: (event: WheelEvent, screenX: number, screenY: number) => void;
    startDragPan?: (screenX: number, screenY: number) => void;
    updateDragPan?: (screenX: number, screenY: number) => void;
    endDragPan?: () => void;
  } | null,
  zones: DepartmentZone[],
  onZoneSelect?: (zoneId: string) => void,
): void {
  const lastKeyTime = useRef(0);
  const lastHover = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const floorMapSize = useStore((s) => s.floorMapSize);
  const setShowMinimap = useStore((s) => s.setShowMinimap);

  useEffect(() => {
    if (!camera) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        camera.zoomIn(lastHover.current);
      }
      if (e.key === '-') {
        e.preventDefault();
        camera.zoomOut(lastHover.current);
      }
      if (e.key === '0') {
        e.preventDefault();
        camera.resetZoom();
      }

      const now = Date.now();
      const debounce = 150;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (now - lastKeyTime.current > debounce) {
          lastKeyTime.current = now;
          camera.panBy(-80, 0);
        }
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (now - lastKeyTime.current > debounce) {
          lastKeyTime.current = now;
          camera.panBy(80, 0);
        }
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (now - lastKeyTime.current > debounce) {
          lastKeyTime.current = now;
          camera.panBy(0, -80);
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (now - lastKeyTime.current > debounce) {
          lastKeyTime.current = now;
          camera.panBy(0, 80);
        }
      }

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const expanded = zones.filter((z) => z.expanded);
        const zone = expanded[idx];
        if (zone && onZoneSelect) onZoneSelect(zone.id);
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        camera.focusSelected?.();
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        const show = useStore.getState().showMinimap;
        setShowMinimap(!show);
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        useStore.getState().setGoToOpen(true);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (isEditableTarget(e.target)) return;

      const floorEl = document.querySelector(FLOOR_SELECTOR);
      if (!floorEl || !floorEl.contains(e.target as Node)) return;

      const rect = floorEl.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      lastHover.current = { x: sx, y: sy };

      e.preventDefault();

      const zoom = camera.getZoom();
      if (e.ctrlKey || e.metaKey) {
        if (camera.handleWheel) {
          camera.handleWheel(e, sx, sy);
        } else if (e.deltaY < 0) {
          camera.zoomIn({ x: sx, y: sy });
        } else {
          camera.zoomOut({ x: sx, y: sy });
        }
        return;
      }

      // Plain wheel / trackpad → pan the floor
      const dx = (e.deltaX + (e.shiftKey ? e.deltaY : 0)) / zoom;
      const dy = (e.shiftKey ? 0 : e.deltaY) / zoom;
      if (dx !== 0 || dy !== 0) camera.panBy(dx, dy);
    };

    const onMouseMove = (e: MouseEvent) => {
      const floorEl = document.querySelector(FLOOR_SELECTOR);
      if (!floorEl) return;
      const rect = floorEl.getBoundingClientRect();
      if (
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom
      ) {
        lastHover.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
    };

    let dragging = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (isEditableTarget(e.target)) return;
      const floorEl = document.querySelector(FLOOR_SELECTOR);
      if (!floorEl || !floorEl.contains(e.target as Node)) return;
      if (!camera.startDragPan) return;
      dragging = true;
      const rect = floorEl.getBoundingClientRect();
      camera.startDragPan(e.clientX - rect.left, e.clientY - rect.top);
      floorEl.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || !camera.updateDragPan) return;
      const floorEl = document.querySelector(FLOOR_SELECTOR);
      if (!floorEl) return;
      const rect = floorEl.getBoundingClientRect();
      camera.updateDragPan(e.clientX - rect.left, e.clientY - rect.top);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      camera.endDragPan?.();
      const floorEl = document.querySelector(FLOOR_SELECTOR);
      if (floorEl) try { floorEl.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, zones, onZoneSelect, floorMapSize, setShowMinimap]);
}

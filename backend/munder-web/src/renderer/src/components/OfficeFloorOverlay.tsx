import { useCallback, useEffect } from 'react';
import { useStore } from '@/store/store';
import { FloorNavBar } from '@/components/FloorNavBar';
import { Minimap } from '@/components/Minimap';
import { GoToPalette } from '@/components/GoToPalette';
import { FlowOrgChart } from '@/components/FlowOrgChart';
import { ConferenceRoomPanel } from '@/components/ConferenceRoomPanel';
import { FloorStatusStrip } from '@/components/FloorStatusStrip';
import { OrgAdminPanel } from '@/components/OrgAdminPanel';
import { KeyboardHelpOverlay } from '@/components/KeyboardHelpOverlay';
import { focusDepartmentZone } from '@/scene/office/floorNavigation';

/** React overlay for OfficeFloor — nav, minimap, go-to, org chart, status strip. */
export function OfficeFloorOverlay() {
  const showMinimap = useStore((s) => s.showMinimap);
  const camera = useStore((s) => s.floorCamera);
  const zones = useStore((s) => s.departmentZones);
  const floorMapSize = useStore((s) => s.floorMapSize);
  const setGoToOpen = useStore((s) => s.setGoToOpen);
  const floorViewMode = useStore((s) => s.floorViewMode);
  const setKeyboardHelpOpen = useStore((s) => s.setKeyboardHelpOpen);

  const focusZone = useCallback((zoneId: string) => {
    focusDepartmentZone(zoneId, camera, zones, floorMapSize.width, floorMapSize.height);
  }, [camera, zones, floorMapSize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGoToOpen(true);
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setKeyboardHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setGoToOpen, setKeyboardHelpOpen]);

  if (floorViewMode === 'orgchart') {
    return (
      <>
        <FlowOrgChart />
        <OrgAdminPanel />
        <KeyboardHelpOverlay />
        <ConferenceRoomPanel />
      </>
    );
  }

  if (!camera) return null;

  return (
    <>
      <FloorNavBar onOpenGoTo={() => setGoToOpen(true)} />
      {showMinimap && <Minimap onZoneClick={focusZone} />}
      <FloorStatusStrip />
      <GoToPalette />
      <OrgAdminPanel />
      <KeyboardHelpOverlay />
      <ConferenceRoomPanel />
    </>
  );
}

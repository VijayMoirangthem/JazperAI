import { create } from 'zustand';
import { BannerCopy, BannerKind, ErrorKind, bannerFor, classifyError } from '@/utils/errors';

export interface SystemBanner extends BannerCopy {
  kind: BannerKind;
}

interface SystemState {
  banner: SystemBanner | null;
  showBanner: (kind: BannerKind) => void;
  reportError: (error: unknown) => ErrorKind;
  dismissBanner: () => void;
}

export const useSystem = create<SystemState>()((set) => ({
  banner: null,
  showBanner: (kind: BannerKind) => {
    const copy = bannerFor(kind);
    if (!copy) return;
    set({ banner: { kind, ...copy } });
  },
  reportError: (error: unknown) => {
    const kind = classifyError(error);
    const copy = bannerFor(kind);
    if (copy) {
      set({ banner: { kind: kind as BannerKind, ...copy } });
    }
    return kind;
  },
  dismissBanner: () => set({ banner: null }),
}));

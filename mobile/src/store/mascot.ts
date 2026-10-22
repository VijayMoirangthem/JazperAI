import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MascotBodyId } from '@/mascot/bodies';
import { defaultMascotBody, defaultMascotColor } from '@/utils/mascot';
import { secureStateStorage } from './storage';

export interface MascotLook {
  color: string;
  body: MascotBodyId;
}

interface MascotLooksState {
  looks: Record<string, MascotLook>;
  setLook: (slug: string, partial: Partial<MascotLook>) => void;
  resetLook: (slug: string) => void;
}

export function lookFor(looks: Record<string, MascotLook>, slug: string): MascotLook {
  const saved = looks[slug];
  if (saved?.color && saved?.body) return saved;
  return { color: defaultMascotColor(slug), body: defaultMascotBody(slug) };
}

export const useMascotLooks = create<MascotLooksState>()(
  persist(
    (set, get) => ({
      looks: {},
      setLook: (slug, partial) =>
        set({
          looks: {
            ...get().looks,
            [slug]: { ...lookFor(get().looks, slug), ...partial },
          },
        }),
      resetLook: (slug) => {
        const looks = { ...get().looks };
        delete looks[slug];
        set({ looks });
      },
    }),
    {
      name: 'jasper-mascot-looks',
      storage: createJSONStorage(() => secureStateStorage),
    }
  )
);

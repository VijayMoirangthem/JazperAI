import { mascotHash, defaultMascotColor, defaultMascotBody, mixHex, mascotGradient } from '@/utils/mascot';
import { MASCOT_BODY_IDS } from '@/mascot/bodies';
import { theme } from '@/theme/tokens';

describe('mascot hash', () => {
  it('is deterministic', () => {
    expect(mascotHash('alice')).toBe(mascotHash('alice'));
    expect(mascotHash('bob')).toBe(mascotHash('bob'));
  });

  it('differs for different slugs', () => {
    expect(mascotHash('alice')).not.toBe(mascotHash('bob'));
  });

  it('jasper hashes to a known value', () => {
    expect(mascotHash('jasper')).toBe(750399560);
  });
});

describe('default mascot colour', () => {
  it('jasper returns blue', () => {
    expect(defaultMascotColor('jasper')).toBe(theme.mascotColors.blue);
  });

  it('falls back to FALLBACK_COLOR_KEYS palette for others', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 100; i++) {
      colors.add(defaultMascotColor(`bot${i}`));
    }
    for (const c of colors) {
      expect(Object.values(theme.mascotColors)).toContain(c);
    }
  });
});

describe('default mascot body', () => {
  it('jasper returns cursor', () => {
    expect(defaultMascotBody('jasper')).toBe('cursor');
  });

  it('others map to one of the ten body ids', () => {
    for (let i = 0; i < 50; i++) {
      const body = defaultMascotBody(`bot${i}`);
      expect(MASCOT_BODY_IDS).toContain(body);
    }
  });
});

describe('mixHex gradient helper', () => {
  it('mix 0 returns from', () => {
    expect(mixHex('#ff0000', '#00ff00', 0)).toBe('#ff0000');
  });

  it('mix 1 returns to', () => {
    expect(mixHex('#ff0000', '#00ff00', 1)).toBe('#00ff00');
  });

  it('mix 0.5 is midway', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('mascotGradient', () => {
  it('returns three stops for a color', () => {
    const [top, mid, bot] = mascotGradient('#377FE6');
    expect(top).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mid).toBe('#377FE6');
    expect(bot).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('top is lighter than mid', () => {
    const [top, mid] = mascotGradient('#377FE6');
    const topVal = Number.parseInt(top.slice(1), 16);
    const midVal = Number.parseInt(mid.slice(1), 16);
    expect(topVal).toBeGreaterThan(midVal);
  });

  it('bottom is darker than mid', () => {
    const [, mid, bot] = mascotGradient('#377FE6');
    const midVal = Number.parseInt(mid.slice(1), 16);
    const botVal = Number.parseInt(bot.slice(1), 16);
    expect(botVal).toBeLessThan(midVal);
  });
});
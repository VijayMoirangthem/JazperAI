import { act } from '@testing-library/react-native';
import { useMascotLooks } from '@/store/mascot';
import { defaultMascotBody, defaultMascotColor } from '@/utils/mascot';

describe('mascot looks store', () => {
  const slug = 'test-bot';

  beforeEach(() => {
    act(() => {
      useMascotLooks.setState({
        looks: {},
        setLook: () => {},
        resetLook: () => {},
      });
    });
  });

  it('returns default look for unknown slug', () => {
    const fallback = { color: defaultMascotColor(slug), body: defaultMascotBody(slug) };
    expect({ color: defaultMascotColor(slug), body: defaultMascotBody(slug) }).toEqual(fallback);
  });

  it('setLook merges color and body', () => {
    act(() => {
      useMascotLooks.getState().setLook(slug, { color: '#ff0000', body: 'star' });
    });
    const look = useMascotLooks.getState().looks[slug];
    expect(look.color).toBe('#ff0000');
    expect(look.body).toBe('star');
  });

  it('setLook partial update keeps other field', () => {
    act(() => {
      useMascotLooks.getState().setLook(slug, { color: '#ff0000', body: 'star' });
    });
    act(() => {
      useMascotLooks.getState().setLook(slug, { color: '#00ff00' });
    });
    const look = useMascotLooks.getState().looks[slug];
    expect(look.color).toBe('#00ff00');
    expect(look.body).toBe('star');
  });

  it('resetLook removes entry and falls back to defaults', () => {
    act(() => {
      useMascotLooks.getState().setLook(slug, { color: '#ff0000', body: 'star' });
    });
    act(() => {
      useMascotLooks.getState().resetLook(slug);
    });
    expect(useMascotLooks.getState().looks[slug]).toBeUndefined();
  });
});
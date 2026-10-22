import React from 'react';
import { render } from '@testing-library/react-native';
import BotCardSheet from './BotCardSheet';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ slug: 'jasper' }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/store/bots', () => ({
  useBots: () => ({
    groups: [
      {
        id: 'group1',
        label: 'Jasper Team',
        bots: [
          {
            slug: 'jasper',
            display_name: 'Jasper',
            position: 'Founder',
            department: 'Core',
            enabled: true,
            score: 95,
            grade: 'A',
            tier: 1,
            group: 'group1',
            group_label: 'Jasper Team',
            reports_to: '�?"',
            created_at: '2024-01-01T00:00:00Z',
            started_at: '2024-01-02T00:00:00Z',
            lifecycle: 'active',
            source: 'custom',
            calls: 1000,
            errors: 5,
            thumbs_up: 50,
            thumbs_down: 2,
            avg_latency_ms: 150,
            last_active_at: '2024-12-01T00:00:00Z',
            tools: ['web.search', 'code.execute', 'file.read'],
            memory_namespace: 'jasper',
            role_title: 'Founder AI',
            settings: {},
          },
        ],
      },
    ],
  }),
}));

jest.mock('@/store/mascot', () => ({
  useMascotLooks: () => ({
    looks: {},
    setLook: jest.fn(),
    resetLook: jest.fn(),
  }),
}));

jest.mock('@/components/Mascot', () => ({
  Mascot: ({ slug, size }: { slug: string; size?: number }) => (
    <View testID={`mascot-${slug}`} style={{ width: size ?? 36, height: size ?? 36 }} />
  ),
}));

import { View } from 'react-native';

describe('BotCardSheet', () => {
  it('renders bot info', async () => {
    const { toJSON } = await render(<BotCardSheet />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('handles null score', async () => {
    const { toJSON } = await render(<BotCardSheet />);
    expect(toJSON()).toMatchSnapshot();
  });
});
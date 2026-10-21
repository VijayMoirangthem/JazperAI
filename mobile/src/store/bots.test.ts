import { loadBotGroups, saveBotGroups, clearBotCache } from '@/db/bots';
import { JasperClient } from '@/api/client';
import { useBots } from './bots';

jest.mock('@/db/bots', () => ({
  initBotsDb: jest.fn(),
  loadBotGroups: jest.fn(),
  saveBotGroups: jest.fn(),
  clearBotCache: jest.fn(),
}));

jest.mock('@/auth/useAuth', () => ({
  useAuth: {
    getState: () => ({
      deviceId: 'test-device',
      deviceSecret: 'test-secret',
      credentials: { baseUrl: 'https://api.example.com', deviceId: 'test-device', deviceSecret: 'test-secret' },
    }),
  },
}));

jest.mock('@/api/client', () => ({
  JasperClient: jest.fn().mockImplementation(() => ({
    getBots: jest.fn(),
  })),
}));

describe('useBots', () => {
  const mockGroups = [
    {
      id: 'group1',
      label: 'Jasper Team',
      bots: [
        { slug: 'jasper', display_name: 'Jasper', position: 'Founder', department: 'Core', enabled: true, score: 95, grade: 'A' },
        { slug: 'analyst', display_name: 'Analyst', position: 'Analyst', department: 'Data', enabled: true, score: 88, grade: 'A' },
      ],
    },
    {
      id: 'group2',
      label: 'Create Origins',
      bots: [
        { slug: 'designer', display_name: 'Designer', position: 'Designer', department: 'Design', enabled: true, score: 82, grade: 'B' },
      ],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (loadBotGroups as jest.Mock).mockReturnValue([]);
    (saveBotGroups as jest.Mock).mockResolvedValue(undefined);
    (clearBotCache as jest.Mock).mockResolvedValue(undefined);
    (JasperClient as jest.Mock).mockImplementation(() => ({
      getBots: jest.fn().mockResolvedValue({ groups: mockGroups }),
    }));
  });

  it('loads bots from API and caches them', async () => {
    const { loadBots } = useBots.getState();
    const mockClient = { getBots: jest.fn().mockResolvedValue({ groups: mockGroups }) };

    await loadBots(mockClient as any);

    expect(saveBotGroups).toHaveBeenCalledWith(mockGroups);
    expect(useBots.getState().groups).toEqual(mockGroups);
    expect(useBots.getState().loading).toBe(false);
  });

  it('sets error on load failure', async () => {
    const { loadBots } = useBots.getState();
    const mockClient = { getBots: jest.fn().mockRejectedValue(new Error('Network error')) };

    await loadBots(mockClient as any);

    expect(useBots.getState().error).toBe('Network error');
    expect(useBots.getState().loading).toBe(false);
  });

  it('clears cache', () => {
    useBots.setState({ groups: mockGroups });
    useBots.getState().clearCache();
    expect(clearBotCache).toHaveBeenCalled();
    expect(useBots.getState().groups).toEqual([]);
  });

  it('clears error', () => {
    useBots.setState({ error: 'Some error' });
    useBots.getState().clearError();
    expect(useBots.getState().error).toBeNull();
  });
});
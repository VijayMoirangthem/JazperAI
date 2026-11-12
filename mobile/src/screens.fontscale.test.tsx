import React from 'react';
import { render, cleanup, act } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';
import ApprovalsScreen from '../app/(tabs)/approvals';
import ActivityScreen from '../app/(tabs)/activity';
import SettingsScreen from '../app/(tabs)/settings';
import ThreadScreen from '../app/thread/[id]';
import { useApprovals } from '@/store/approvals';
import { useActivity } from '@/store/activity';
import { useThread } from '@/store/thread';
import { useAuth } from '@/auth/useAuth';
import { SLO, CommsThread, ApprovalRequest, StatusResponse } from '@/api/types';

jest.mock('react-native-reanimated', () => require('./test-utils/reanimatedMock'));
jest.mock('lucide-react-native', () => require('./test-utils/lucideMock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => {},
  useLocalSearchParams: () => ({ slug: 'jasper', id: 'thread-1' }),
  Href: {},
}));

jest.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: jest.fn(),
}));

jest.mock('@/store/chat', () => ({
  useChat: { getState: () => ({ flushOutbox: jest.fn() }) },
}));

jest.mock('@/store/system', () => ({
  useSystem: { getState: () => ({ banner: null, showBanner: jest.fn(), dismissBanner: jest.fn() }) },
}));

jest.mock('@/outbox/retry', () => ({
  startOutboxRetries: () => () => {},
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execSync: jest.fn(),
    runSync: jest.fn(() => ({ lastInsertRowId: 1, changes: 0 })),
    getAllSync: jest.fn(() => []),
  }),
}));

jest.mock('@/db/bots', () => ({
  initBotsDb: jest.fn(),
  loadBotGroups: jest.fn(() => []),
  saveBotGroups: jest.fn(),
  clearBotCache: jest.fn(),
}));

jest.mock('@/db/chat', () => ({
  initChatDb: jest.fn(),
  listMessages: jest.fn(() => []),
  insertMessage: jest.fn(() => 1),
  updateMessage: jest.fn(),
  deleteMessage: jest.fn(),
  deleteMessagesFromId: jest.fn(),
  addToOutbox: jest.fn(() => 1),
  getOutboxItems: jest.fn(() => []),
  removeOutboxItem: jest.fn(),
  clearOutbox: jest.fn(),
}));

jest.mock('@/store/bots', () => ({
  useBots: { getState: () => ({ groups: [], loading: false, error: null, search: '' }) },
}));

jest.mock('@/store/speech', () => ({
  useSpeech: { getState: () => ({ messageId: null, speak: jest.fn(), stop: jest.fn(), error: null, clearError: jest.fn() }) },
}));

jest.mock('@/voice/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({ recording: false, seconds: 0, transcribing: false, error: null, start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), clearError: jest.fn() }),
}));

const mockStatus: StatusResponse = {
  slos: [
    {
      slo: 'api-latency',
      target: 200,
      sli: 150,
      events: 1000,
      bad: 5,
      budget_remaining: 0.95,
      status: 'ok' as const,
    },
    {
      slo: 'error-rate',
      target: 0.01,
      sli: 0.005,
      events: 1000,
      bad: 5,
      budget_remaining: 0.5,
      status: 'ok' as const,
    },
  ] satisfies SLO[],
  pending_approvals: 0,
};

const mockThread: CommsThread = {
  thread: 'jasper-analyst',
  from_slug: 'jasper',
  to_slug: 'analyst',
  kind: 'message',
  preview: 'Hello there',
  ts: new Date().toISOString(),
  n: 5,
};

const mockApproval: ApprovalRequest = {
  request_id: 'req-1',
  tier: 2,
  action: 'Send email',
  summary: 'Send a test email',
  requester: 'jasper',
  created_at: new Date().toISOString(),
};

describe('main screens render at 150% font scale', () => {
  beforeEach(() => {
    cleanup();
    jest.useFakeTimers();
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.5);

    useAuth.setState({ credentials: null, accessToken: null, deviceId: null, deviceSecret: null, deviceName: null, hydrated: true });
    useApprovals.setState({ requests: [mockApproval], loading: false, error: null, responding: {} });
    useActivity.setState({ status: mockStatus, threads: [mockThread], loading: false, error: null });
    useThread.setState({ threadId: 'thread-1', messages: [], sinceId: 0, loading: false, error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders ApprovalsScreen without crashing', async () => {
    const { getByText } = await act(async () => render(<ApprovalsScreen />));
    expect(getByText('Approvals')).toBeTruthy();
  });

  it('renders ActivityScreen without crashing', async () => {
    const { getByText } = await act(async () => render(<ActivityScreen />));
    expect(getByText('Activity')).toBeTruthy();
  });

  it('renders SettingsScreen without crashing', async () => {
    const { getByText } = await act(async () => render(<SettingsScreen />));
    expect(getByText('Voice conversation')).toBeTruthy(); // a current Settings row (the old 'Paired Device' heading no longer exists)
  });

  it('renders ThreadScreen without crashing', async () => {
    const { getByText } = await act(async () => render(<ThreadScreen />));
    expect(getByText('thread-1')).toBeTruthy();
  });
});
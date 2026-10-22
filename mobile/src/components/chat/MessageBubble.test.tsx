import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import { MessageBubble } from './MessageBubble';
import { Message } from '@/db/chat';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    bot_slug: 'jasper',
    role: 'assistant',
    from_slug: 'jasper',
    text: 'Hello there',
    ts: new Date('2026-01-02T10:30:00Z').getTime(),
    status: 'done',
    ...overrides,
  };
}

describe('MessageBubble', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders user text', async () => {
    const { getByText } = await render(<MessageBubble message={makeMessage({ role: 'user', text: 'Hi Jasper' })} />);
    expect(getByText('Hi Jasper')).toBeTruthy();
  });

  it('renders bot text', async () => {
    const { getByText } = await render(<MessageBubble message={makeMessage({ text: 'Hello from Jasper' })} />);
    expect(getByText('Hello from Jasper')).toBeTruthy();
  });

  it('renders markdown bold and code', async () => {
    const { getByText } = await render(<MessageBubble message={makeMessage({ text: 'Use **bold** and `code` now' })} />);
    expect(getByText('bold')).toBeTruthy();
    expect(getByText('code')).toBeTruthy();
  });

  it('calls onLongPress when the bubble is held', async () => {
    const onLongPress = jest.fn();
    const { getByLabelText } = await render(<MessageBubble message={makeMessage()} onLongPress={onLongPress} />);
    fireEvent(getByLabelText('Bot message'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('calls onThumbsUp on the last completed bot message', async () => {
    const onThumbsUp = jest.fn();
    const { getByLabelText } = await render(
      <MessageBubble message={makeMessage()} isLastBotMessage onThumbsUp={onThumbsUp} />
    );

    fireEvent.press(getByLabelText('Thumbs up'));

    expect(onThumbsUp).toHaveBeenCalledTimes(1);
  });

  it('calls onThumbsDown on the last completed bot message', async () => {
    const onThumbsDown = jest.fn();
    const { getByLabelText } = await render(
      <MessageBubble message={makeMessage()} isLastBotMessage onThumbsDown={onThumbsDown} />
    );

    fireEvent.press(getByLabelText('Thumbs down'));

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
  });

  it('hides thumbs when the message is not last', async () => {
    const { queryByLabelText } = await render(
      <MessageBubble message={makeMessage()} isLastBotMessage={false} onThumbsUp={jest.fn()} />
    );
    expect(queryByLabelText('Thumbs up')).toBeNull();
  });

  it('hides thumbs while a bot message is streaming', async () => {
    const { queryByLabelText } = await render(
      <MessageBubble message={makeMessage({ status: 'streaming' })} isLastBotMessage onThumbsUp={jest.fn()} />
    );
    expect(queryByLabelText('Thumbs up')).toBeNull();
  });

  it('renders a tool chip with its label', async () => {
    const tool = JSON.stringify({ name: 'web.search', label: 'Searching the web', status: 'running' });
    const { getByText } = await render(<MessageBubble message={makeMessage({ role: 'tool', tool_json: tool })} />);
    expect(getByText('Searching the web')).toBeTruthy();
  });

  it('marks untrusted tool results', async () => {
    const tool = JSON.stringify({
      name: 'web.fetch',
      label: 'Fetched page',
      status: 'ok',
      untrusted: true,
    });
    const { getByText } = await render(<MessageBubble message={makeMessage({ role: 'tool', tool_json: tool })} />);
    expect(getByText('untrusted')).toBeTruthy();
  });

  it('renders a neutral system divider', async () => {
    const { getByText } = await render(
      <MessageBubble message={makeMessage({ role: 'system', text: 'Conversation started', status: 'sent' })} />
    );
    expect(getByText('Conversation started')).toBeTruthy();
  });

  it('renders an error system message', async () => {
    const { getByText } = await render(
      <MessageBubble message={makeMessage({ role: 'system', text: 'Network failed', status: 'error' })} />
    );
    expect(getByText('Network failed')).toBeTruthy();
  });

  it('renders a ui card with the connector name', async () => {
    const ui = JSON.stringify({ kind: 'oauth', connector: 'google' });
    const { getByText } = await render(<MessageBubble message={makeMessage({ role: 'ui', ui_json: ui })} />);
    expect(getByText('Finish this on your computer')).toBeTruthy();
    expect(getByText('google')).toBeTruthy();
    expect(getByText('Connect on desktop')).toBeTruthy();
  });

  it('renders attachment chips with readability notes', async () => {
    const attachments = JSON.stringify([
      { name: 'notes.txt', mime: 'text/plain', text: 'hi' },
      { name: 'report.pdf', mime: 'application/pdf' },
    ]);
    const { getByText } = await render(
      <MessageBubble message={makeMessage({ role: 'user', attachments_json: attachments })} />
    );

    expect(getByText('notes.txt')).toBeTruthy();
    expect(getByText('text included')).toBeTruthy();
    expect(getByText('report.pdf')).toBeTruthy();
    expect(getByText('not readable by the AI')).toBeTruthy();
  });

  it('starts reading a bot message', async () => {
    const onSpeak = jest.fn();
    const { getByLabelText } = await render(
      <MessageBubble message={makeMessage()} onSpeak={onSpeak} onStopSpeak={jest.fn()} />
    );

    fireEvent.press(getByLabelText('Read aloud'));

    expect(onSpeak).toHaveBeenCalledTimes(1);
  });

  it('stops reading while speaking', async () => {
    const onStopSpeak = jest.fn();
    const { getByLabelText } = await render(
      <MessageBubble message={makeMessage()} speaking onSpeak={jest.fn()} onStopSpeak={onStopSpeak} />
    );

    fireEvent.press(getByLabelText('Stop reading'));

    expect(onStopSpeak).toHaveBeenCalledTimes(1);
  });

  it('renders suggestion items as read-only cards', async () => {
    const ui = JSON.stringify({
      kind: 'suggestions',
      connector: 'Connections',
      items: [{ name: 'Send email', why: 'You asked to reply', status: 'new' }],
    });
    const { getByText } = await render(<MessageBubble message={makeMessage({ role: 'ui', ui_json: ui })} />);
    expect(getByText('Suggestions')).toBeTruthy();
    expect(getByText('Send email')).toBeTruthy();
    expect(getByText('You asked to reply')).toBeTruthy();
    expect(getByText('new')).toBeTruthy();
    expect(getByText('Connect on desktop')).toBeTruthy();
  });
});

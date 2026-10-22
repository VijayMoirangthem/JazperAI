import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Composer } from './Composer';

const baseProps = {
  text: '',
  onChangeText: jest.fn(),
  streaming: false,
  onSend: jest.fn(),
  onStop: jest.fn(),
};

describe('Composer', () => {
  it('renders the placeholder', async () => {
    await render(<Composer {...baseProps} placeholder="Message Jasper" />);
    expect(screen.getByPlaceholderText('Message Jasper')).toBeTruthy();
  });

  it('reports text changes', async () => {
    const onChangeText = jest.fn();
    await render(<Composer {...baseProps} onChangeText={onChangeText} />);
    fireEvent.changeText(screen.getByLabelText('Message'), 'hello');
    expect(onChangeText).toHaveBeenCalledWith('hello');
  });

  it('sends when text is present', async () => {
    const onSend = jest.fn();
    await render(<Composer {...baseProps} text="hello" onSend={onSend} />);
    fireEvent.press(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not send empty or whitespace text', async () => {
    const onSend = jest.fn();
    await render(<Composer {...baseProps} text="   " onSend={onSend} />);
    fireEvent.press(screen.getByLabelText('Send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows stop instead of send while streaming', async () => {
    const onStop = jest.fn();
    await render(<Composer {...baseProps} text="hello" streaming onStop={onStop} />);
    expect(screen.queryByLabelText('Send')).toBeNull();
    fireEvent.press(screen.getByLabelText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('renders pending attachment chips', async () => {
    await render(
      <Composer
        {...baseProps}
        attachments={[{ name: 'notes.txt', mime: 'text/plain', text: 'hi' }]}
      />
    );
    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(screen.getByLabelText('Remove notes.txt')).toBeTruthy();
  });

  it('removes a pending attachment', async () => {
    const onRemoveAttachment = jest.fn();
    await render(
      <Composer
        {...baseProps}
        attachments={[{ name: 'notes.txt', mime: 'text/plain', text: 'hi' }]}
        onRemoveAttachment={onRemoveAttachment}
      />
    );
    fireEvent.press(screen.getByLabelText('Remove notes.txt'));
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);
  });

  it('sends a message that only has an attachment', async () => {
    const onSend = jest.fn();
    await render(
      <Composer {...baseProps} onSend={onSend} attachments={[{ name: 'a.png', mime: 'image/png' }]} />
    );
    fireEvent.press(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('lists the attachment sources', async () => {
    await render(<Composer {...baseProps} />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    expect(await screen.findByText('Camera')).toBeTruthy();
    expect(screen.getByText('Gallery')).toBeTruthy();
    expect(screen.getByText('Files')).toBeTruthy();
  });

  it('starts a voice note', async () => {
    const onStartRecording = jest.fn();
    await render(<Composer {...baseProps} onStartRecording={onStartRecording} />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    expect(onStartRecording).toHaveBeenCalledTimes(1);
  });

  it('shows the recording timer and cancels', async () => {
    const onCancelRecording = jest.fn();
    await render(
      <Composer {...baseProps} recording recordingSeconds={65} onCancelRecording={onCancelRecording} />
    );
    expect(screen.getByText('1:05')).toBeTruthy();
    fireEvent.press(screen.getByText('Cancel'));
    expect(onCancelRecording).toHaveBeenCalledTimes(1);
  });

  it('shows voice errors with a dismiss control', async () => {
    const onDismissVoiceError = jest.fn();
    await render(
      <Composer {...baseProps} voiceError="Microphone denied" onDismissVoiceError={onDismissVoiceError} />
    );
    expect(screen.getByText('Microphone denied')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Dismiss voice error'));
    expect(onDismissVoiceError).toHaveBeenCalledTimes(1);
  });
});

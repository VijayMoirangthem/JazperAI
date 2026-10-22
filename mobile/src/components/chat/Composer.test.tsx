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
});

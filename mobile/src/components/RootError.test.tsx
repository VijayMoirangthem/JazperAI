import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react-native';
import { RootError } from './RootError';

describe('RootError', () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  });

  it('shows a friendly message and restarts', async () => {
    const retry = jest.fn();
    const { getByText, getByLabelText } = await render(
      <RootError error={new Error('boom')} retry={retry} />
    );

    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText('boom')).toBeTruthy();

    fireEvent.press(getByLabelText('Restart'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('hides the error detail outside development', async () => {
    Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
    const { queryByText, getByText } = await render(
      <RootError error={new Error('secret stack detail')} retry={jest.fn()} />
    );

    expect(getByText('Something went wrong')).toBeTruthy();
    expect(queryByText('secret stack detail')).toBeNull();
  });
});

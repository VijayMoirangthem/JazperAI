import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Button } from './Button';

describe('Button', () => {
  it('renders title', async () => {
    const { toJSON } = await render(<Button title="Press me" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    await render(<Button title="Press me" onPress={onPress} />);
    fireEvent.press(screen.getByText('Press me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Press me" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Press me'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress when loading', async () => {
    const onPress = jest.fn();
    await render(<Button title="Press me" onPress={onPress} loading />);
    fireEvent.press(screen.getByText('Loading...'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows loading text when loading', async () => {
    const { toJSON } = await render(<Button title="Press me" loading />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies primary variant styles', async () => {
    const { toJSON } = await render(<Button title="Primary" variant="primary" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies secondary variant styles', async () => {
    const { toJSON } = await render(<Button title="Secondary" variant="secondary" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies danger variant styles', async () => {
    const { toJSON } = await render(<Button title="Danger" variant="danger" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
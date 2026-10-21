import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title', async () => {
    const { toJSON } = await render(<EmptyState title="No items" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders subtitle', async () => {
    const { toJSON } = await render(<EmptyState title="No items" subtitle="Try again later" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders action button', async () => {
    const { toJSON } = await render(<EmptyState title="No items" actionLabel="Retry" onAction={() => {}} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('calls onAction when button pressed', async () => {
    const onAction = jest.fn();
    await render(<EmptyState title="No items" actionLabel="Retry" onAction={onAction} />);
    fireEvent.press(screen.getByText('Retry'));
    expect(onAction).toHaveBeenCalledTimes(1);
  }, 10000);

  it('applies custom styles', async () => {
    const { toJSON } = await render(
      <EmptyState title="No items" titleStyle={{ color: 'red' }} subtitleStyle={{ fontSize: 12 }} />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
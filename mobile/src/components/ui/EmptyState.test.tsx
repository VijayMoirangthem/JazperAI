import React from 'react';
import { render } from '@testing-library/react-native';
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
  }, 10000);

  it('applies custom styles', async () => {
    const { toJSON } = await render(
      <EmptyState title="No items" titleStyle={{ color: 'red' }} subtitleStyle={{ fontSize: 12 }} />
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
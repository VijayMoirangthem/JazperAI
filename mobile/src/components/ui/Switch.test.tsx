import React from 'react';
import { render } from '@testing-library/react-native';
import { Switch } from './Switch';

describe('Switch', () => {
  it('renders with correct initial value', async () => {
    const { toJSON } = await render(<Switch value={false} onValueChange={() => {}} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('respects disabled prop', async () => {
    const { toJSON } = await render(<Switch value={false} onValueChange={() => {}} disabled />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies custom track colors', async () => {
    const { toJSON } = await render(
      <Switch value={true} onValueChange={() => {}} trackColor={{ false: 'red', true: 'green' }} />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies custom thumb color', async () => {
    const { toJSON } = await render(<Switch value={true} onValueChange={() => {}} thumbColor="blue" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
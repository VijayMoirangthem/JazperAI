import React from 'react';
import { render } from '@testing-library/react-native';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders children', async () => {
    const { toJSON } = await render(<Chip>Chip label</Chip>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies selected styles', async () => {
    const { toJSON } = await render(<Chip selected>Selected</Chip>);
    expect(toJSON()).toMatchSnapshot();
  });
});
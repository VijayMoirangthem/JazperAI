import React from 'react';
import { render } from '@testing-library/react-native';
import { Divider } from './Divider';

describe('Divider', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<Divider />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies custom style', async () => {
    const { toJSON } = await render(<Divider style={{ marginVertical: 20 }} />);
    expect(toJSON()).toMatchSnapshot();
  });
});
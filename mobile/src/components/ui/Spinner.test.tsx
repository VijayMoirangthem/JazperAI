import React from 'react';
import { render } from '@testing-library/react-native';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<Spinner />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies size prop', async () => {
    const { toJSON } = await render(<Spinner size="small" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies color prop', async () => {
    const { toJSON } = await render(<Spinner color="#ff0000" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from './Text';

describe('Text', () => {
  it('renders children', async () => {
    const { toJSON } = await render(<Text>Hello world</Text>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies title variant styles', async () => {
    const { toJSON } = await render(<Text variant="title">Title</Text>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies muted variant styles', async () => {
    const { toJSON } = await render(<Text variant="muted">Muted text</Text>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies caption variant styles', async () => {
    const { toJSON } = await render(<Text variant="caption">Caption</Text>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('passes numberOfLines prop', async () => {
    const { toJSON } = await render(<Text numberOfLines={2}>Long text</Text>);
    expect(toJSON()).toMatchSnapshot();
  });
});
import React from 'react';
import { render } from '@testing-library/react-native';
import { Card } from './Card';
import { Text } from './Text';

describe('Card', () => {
  it('renders children', async () => {
    const { toJSON } = await render(<Card><Text>Card content</Text></Card>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies custom padding', async () => {
    const { toJSON } = await render(<Card padding="sm"><Text>Content</Text></Card>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies custom style', async () => {
    const { toJSON } = await render(<Card style={{ marginTop: 10 }}><Text>Content</Text></Card>);
    expect(toJSON()).toMatchSnapshot();
  });
});
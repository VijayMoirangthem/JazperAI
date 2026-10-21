import React from 'react';
import { render } from '@testing-library/react-native';
import { Screen } from './Screen';
import { Text } from './Text';

describe('Screen', () => {
  it('renders children', async () => {
    const { toJSON } = await render(<Screen><Text>Test content</Text></Screen>);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies custom style', async () => {
    const { toJSON } = await render(<Screen style={{ padding: 20 }}><Text>Content</Text></Screen>);
    expect(toJSON()).toMatchSnapshot();
  });
});
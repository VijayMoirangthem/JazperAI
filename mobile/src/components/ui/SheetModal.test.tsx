import React from 'react';
import { render } from '@testing-library/react-native';
import { SheetModal } from './SheetModal';
import { Text } from './Text';

describe('SheetModal', () => {
  it('renders children when visible', async () => {
    const { toJSON } = await render(
      <SheetModal visible={true} onClose={() => {}}>
        <Text>Modal content</Text>
      </SheetModal>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('does not render when not visible', async () => {
    const { queryByText } = await render(
      <SheetModal visible={false} onClose={() => {}}>
        <Text>Modal content</Text>
      </SheetModal>
    );
    expect(queryByText('Modal content')).toBeNull();
  });

  it('renders title', async () => {
    const { toJSON } = await render(
      <SheetModal visible={true} onClose={() => {}} title="Modal Title">
        <Text>Content</Text>
      </SheetModal>
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
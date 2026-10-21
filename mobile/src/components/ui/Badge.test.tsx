import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders score number', async () => {
    const { toJSON } = await render(<Badge score={85} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders "new" for null score', async () => {
    const { toJSON } = await render(<Badge score={null} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies green for score >= 80', async () => {
    const { toJSON } = await render(<Badge score={90} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies amber for score >= 60', async () => {
    const { toJSON } = await render(<Badge score={70} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies red for score < 60', async () => {
    const { toJSON } = await render(<Badge score={50} />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('applies grey for null score', async () => {
    const { toJSON } = await render(<Badge score={null} />);
    expect(toJSON()).toMatchSnapshot();
  });
});
import { transcribeUri } from './transcribe';

describe('transcribeUri', () => {
  it('returns the transcribed text', async () => {
    const transcribe = jest.fn().mockResolvedValue({ text: 'Remind me at noon' });
    const loadBlob = jest.fn().mockResolvedValue({ size: 3 } as Blob);

    const text = await transcribeUri('file:///note.m4a', transcribe, loadBlob);

    expect(text).toBe('Remind me at noon');
    expect(loadBlob).toHaveBeenCalledWith('file:///note.m4a');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('returns an empty string when the service returns no text', async () => {
    const transcribe = jest.fn().mockResolvedValue({ text: '' });
    const loadBlob = jest.fn().mockResolvedValue({ size: 3 } as Blob);

    await expect(transcribeUri('file:///note.m4a', transcribe, loadBlob)).resolves.toBe('');
  });

  it('surfaces transcription errors', async () => {
    const transcribe = jest.fn().mockRejectedValue(new Error('Could not transcribe'));
    const loadBlob = jest.fn().mockResolvedValue({ size: 3 } as Blob);

    await expect(transcribeUri('file:///note.m4a', transcribe, loadBlob)).rejects.toThrow(
      'Could not transcribe'
    );
  });
});

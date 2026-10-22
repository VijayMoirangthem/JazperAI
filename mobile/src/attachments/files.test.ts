import { File } from 'expo-file-system';
import { attachmentFromFile, attachmentFromImage } from './files';
import { MAX_TEXT_CHARS } from '@/utils/attachments';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const readText = jest.fn();
const FileMock = File as unknown as jest.Mock;

describe('attachment picking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FileMock.mockImplementation(() => ({ text: readText }));
  });

  it('reads text-like files and clamps the content', async () => {
    readText.mockResolvedValue('a'.repeat(MAX_TEXT_CHARS + 10));

    const attachment = await attachmentFromFile({
      name: 'notes.md',
      uri: 'file:///notes.md',
      mimeType: 'text/markdown',
    });

    expect(attachment.name).toBe('notes.md');
    expect(attachment.mime).toBe('text/markdown');
    expect(attachment.text).toHaveLength(MAX_TEXT_CHARS);
    expect(attachment.uri).toBe('file:///notes.md');
  });

  it('does not read binary files', async () => {
    const attachment = await attachmentFromFile({
      name: 'report.pdf',
      uri: 'file:///report.pdf',
      mimeType: 'application/pdf',
    });

    expect(attachment).toEqual({
      name: 'report.pdf',
      mime: 'application/pdf',
      uri: 'file:///report.pdf',
    });
    expect(readText).not.toHaveBeenCalled();
  });

  it('keeps the file when reading fails', async () => {
    readText.mockRejectedValue(new Error('unreadable'));

    const attachment = await attachmentFromFile({
      name: 'notes.txt',
      uri: 'file:///notes.txt',
    });

    expect(attachment).toEqual({
      name: 'notes.txt',
      mime: 'text/plain',
      uri: 'file:///notes.txt',
    });
  });

  it('maps picked images to image attachments', () => {
    const attachment = attachmentFromImage({
      uri: 'file:///photo.jpg',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
    });

    expect(attachment).toEqual({
      name: 'photo.jpg',
      mime: 'image/jpeg',
      uri: 'file:///photo.jpg',
    });
  });
});

import { Attachment } from '@/api/types';
import {
  MAX_ATTACHMENTS,
  MAX_TEXT_CHARS,
  addAttachment,
  clampText,
  isImageAttachment,
  isReadableAttachment,
  isTextLikeFile,
  mimeFallback,
  toApiAttachment,
} from './attachments';

describe('attachment helpers', () => {
  it('detects text-like files by extension', () => {
    expect(isTextLikeFile('notes.txt')).toBe(true);
    expect(isTextLikeFile('README.MD')).toBe(true);
    expect(isTextLikeFile('data.json')).toBe(true);
    expect(isTextLikeFile('script.py')).toBe(true);
    expect(isTextLikeFile('report.pdf')).toBe(false);
    expect(isTextLikeFile('photo.jpg')).toBe(false);
  });

  it('clamps text to 200 000 characters', () => {
    const long = 'x'.repeat(MAX_TEXT_CHARS + 25);
    const clamped = clampText(long);
    expect(clamped).toHaveLength(MAX_TEXT_CHARS);
    expect(clampText('short')).toBe('short');
  });

  it('caps pending attachments at 8', () => {
    let list: Attachment[] = [];
    for (let index = 0; index < MAX_ATTACHMENTS + 2; index += 1) {
      list = addAttachment(list, { name: `file-${index}.txt`, mime: 'text/plain' });
    }
    expect(list).toHaveLength(MAX_ATTACHMENTS);
    expect(list[0].name).toBe('file-0.txt');
  });

  it('falls back to a sensible mime type', () => {
    expect(mimeFallback('a.json')).toBe('application/json');
    expect(mimeFallback('a.csv')).toBe('text/csv');
    expect(mimeFallback('a.md')).toBe('text/markdown');
    expect(mimeFallback('a.bin')).toBe('application/octet-stream');
  });

  it('strips local-only fields before sending', () => {
    expect(toApiAttachment({ name: 'a.txt', mime: 'text/plain', text: 'hi', uri: 'file:///a.txt' })).toEqual({
      name: 'a.txt',
      mime: 'text/plain',
      text: 'hi',
    });
    expect(toApiAttachment({ name: 'a.png', mime: 'image/png', uri: 'file:///a.png' })).toEqual({
      name: 'a.png',
      mime: 'image/png',
    });
  });

  it('marks readable text and local images', () => {
    expect(isReadableAttachment({ name: 'a.txt', mime: 'text/plain', text: 'hi' })).toBe(true);
    expect(isReadableAttachment({ name: 'a.png', mime: 'image/png' })).toBe(false);
    expect(isImageAttachment({ name: 'a.png', mime: 'image/png', uri: 'file:///a.png' })).toBe(true);
    expect(isImageAttachment({ name: 'a.png', mime: 'image/png' })).toBe(false);
  });
});

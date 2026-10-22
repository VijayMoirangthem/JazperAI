import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('returns plain text as a single text part', () => {
    expect(parseInline('hello there')).toEqual([{ type: 'text', text: 'hello there' }]);
  });

  it('returns an empty list for empty text', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('parses bold text', () => {
    expect(parseInline('a **bold** word')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' word' },
    ]);
  });

  it('parses inline code', () => {
    expect(parseInline('run `npm test` now')).toEqual([
      { type: 'text', text: 'run ' },
      { type: 'code', text: 'npm test' },
      { type: 'text', text: ' now' },
    ]);
  });

  it('parses links', () => {
    expect(parseInline('see [docs](https://example.com)')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'docs', url: 'https://example.com' },
    ]);
  });

  it('keeps the text around several inline parts', () => {
    const parts = parseInline('**a** and `b` and [c](https://d.test)');
    expect(parts.map((part) => part.type)).toEqual(['bold', 'text', 'code', 'text', 'link']);
  });
});

describe('parseMarkdown', () => {
  it('returns no blocks for empty text', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('parses a plain paragraph', () => {
    const blocks = parseMarkdown('just a sentence');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });

  it('parses a fenced code block with its language', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n```');
    expect(blocks).toEqual([{ type: 'code', language: 'ts', code: 'const a = 1;' }]);
  });

  it('parses a fenced code block without a language', () => {
    const blocks = parseMarkdown('```\nplain\n```');
    expect(blocks).toEqual([{ type: 'code', language: '', code: 'plain' }]);
  });

  it('parses bullet lists', () => {
    const blocks = parseMarkdown('- first\n- second');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('bullets');
    if (blocks[0].type === 'bullets') {
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it('parses bullets with inline formatting', () => {
    const blocks = parseMarkdown('- **one**');
    expect(blocks[0].type).toBe('bullets');
    if (blocks[0].type === 'bullets') {
      expect(blocks[0].items[0]).toEqual([{ type: 'bold', text: 'one' }]);
    }
  });

  it('keeps code blocks separate from paragraphs', () => {
    const blocks = parseMarkdown('before\n\n```\nx\n```\n\nafter');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'code', 'paragraph']);
  });

  it('treats an unterminated fence as a code block', () => {
    const blocks = parseMarkdown('```\nno end');
    expect(blocks).toEqual([{ type: 'code', language: '', code: 'no end' }]);
  });
});

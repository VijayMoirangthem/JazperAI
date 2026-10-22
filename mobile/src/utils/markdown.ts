export type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string };

export type MarkdownBlock =
  | { type: 'paragraph'; parts: InlinePart[] }
  | { type: 'bullets'; items: InlinePart[][] }
  | { type: 'code'; language: string; code: string };

const INLINE_PATTERN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const BULLET_PATTERN = /^[-*]\s+(.*)$/;
const FENCE_PATTERN = /^```(.*)$/;

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  if (!text) return parts;

  let lastIndex = 0;
  let match: RegExpExecArray | null = INLINE_PATTERN.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: 'bold', text: match[1] });
    } else if (match[2] !== undefined) {
      parts.push({ type: 'code', text: match[2] });
    } else if (match[3] !== undefined && match[4] !== undefined) {
      parts.push({ type: 'link', text: match[3], url: match[4] });
    }
    lastIndex = INLINE_PATTERN.lastIndex;
    match = INLINE_PATTERN.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return parts;
}

export function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  if (!text) return blocks;

  const lines = text.split('\n');
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    const fence = FENCE_PATTERN.exec(trimmed);

    if (fence) {
      const language = fence[1].trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_PATTERN.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const bullet = BULLET_PATTERN.exec(trimmed);
    if (bullet) {
      const items: InlinePart[][] = [];
      while (index < lines.length) {
        const line = lines[index].trim();
        const item = BULLET_PATTERN.exec(line);
        if (!item) break;
        items.push(parseInline(item[1]));
        index += 1;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }

    if (!trimmed) {
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line || FENCE_PATTERN.test(line) || BULLET_PATTERN.test(line)) break;
      paragraphLines.push(line);
      index += 1;
    }
    blocks.push({ type: 'paragraph', parts: parseInline(paragraphLines.join('\n')) });
  }

  return blocks;
}

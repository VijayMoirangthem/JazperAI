import { File } from 'expo-file-system';
import { Attachment } from '@/api/types';
import { clampText, isTextLikeFile, mimeFallback } from '@/utils/attachments';

export interface PickedFile {
  name: string;
  uri: string;
  mimeType?: string | null;
}

export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export async function attachmentFromFile(file: PickedFile): Promise<Attachment> {
  const mime = file.mimeType || mimeFallback(file.name);
  if (!isTextLikeFile(file.name)) {
    return { name: file.name, mime, uri: file.uri };
  }

  try {
    const text = clampText(await new File(file.uri).text());
    return { name: file.name, mime, text, uri: file.uri };
  } catch {
    return { name: file.name, mime, uri: file.uri };
  }
}

export function attachmentFromImage(image: PickedImage): Attachment {
  return {
    name: image.fileName || `photo-${Date.now()}.jpg`,
    mime: image.mimeType || 'image/jpeg',
    uri: image.uri,
  };
}

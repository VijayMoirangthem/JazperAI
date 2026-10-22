export type TranscribeFn = (audio: Blob) => Promise<{ text: string }>;

export async function blobFromUri(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Could not read the recording (${response.status})`);
  }
  return response.blob();
}

export async function transcribeUri(
  uri: string,
  transcribe: TranscribeFn,
  loadBlob: (uri: string) => Promise<Blob> = blobFromUri
): Promise<string> {
  const blob = await loadBlob(uri);
  const result = await transcribe(blob);
  return result.text ?? '';
}

export const MAX_EXTERNAL_RESPONSE_BYTES = 2_000_000;

const textDecoder = new TextDecoder();

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;
  try {
    await body.cancel("PROVIDER_RESPONSE_TOO_LARGE");
  } catch {
    // Preserve the size-limit error even if the provider stream cannot cancel.
  }
}

export async function readResponseTextWithinLimit(
  response: Response,
  maxBytes = MAX_EXTERNAL_RESPONSE_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("INVALID_RESPONSE_BYTE_LIMIT");
  }

  const contentLength = response.headers.get("content-length")?.trim();
  if (
    contentLength && /^\d+$/.test(contentLength) &&
    BigInt(contentLength) > BigInt(maxBytes)
  ) {
    await cancelBody(response.body);
    throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel("PROVIDER_RESPONSE_TOO_LARGE");
        } catch {
          // Preserve the size-limit error even if the provider stream cannot cancel.
        }
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return textDecoder.decode(bytes);
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export interface FetchMediaOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxSizeBytes?: number;
}

/** Download media from a URL and return as Buffer */
export async function fetchMediaFromUrl(
  url: string,
  options?: FetchMediaOptions,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      headers: options?.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    const maxSize = options?.maxSizeBytes ?? MAX_SIZE_BYTES;
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      throw new Error(
        `Media too large: ${contentLength} bytes exceeds ${maxSize} byte limit`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > maxSize) {
      throw new Error(
        `Media too large: ${buffer.length} bytes exceeds ${maxSize} byte limit`,
      );
    }

    const mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ??
      "application/octet-stream";

    // Extract filename from Content-Disposition or URL
    const disposition = response.headers.get("content-disposition");
    let filename = "download";
    if (disposition) {
      const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';\n]+)/i);
      if (match) filename = decodeURIComponent(match[1]!);
    } else {
      const urlPath = new URL(url).pathname;
      const lastSegment = urlPath.split("/").pop();
      if (lastSegment && lastSegment.includes(".")) filename = lastSegment;
    }

    return { buffer, mimeType, filename };
  } finally {
    clearTimeout(timeout);
  }
}

/** Download Telegram file using Bot API getFile */
export async function fetchTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  // Get file path from Telegram API
  const apiUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Telegram getFile failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  if (!data.ok || !data.result?.file_path) {
    throw new Error("Telegram getFile returned no file_path");
  }

  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
  return fetchMediaFromUrl(downloadUrl);
}

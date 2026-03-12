import sharp from "sharp";

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
}

export interface MediaMetadata {
  type: "image" | "video" | "audio" | "document";
  mimeType: string;
  size: number;
  image?: ImageMetadata;
}

/** Extract metadata from an image buffer */
export async function parseImageMetadata(buffer: Buffer): Promise<ImageMetadata> {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? "unknown",
    size: buffer.length,
    hasAlpha: metadata.hasAlpha ?? false,
  };
}

/** Parse media metadata based on MIME type */
export async function parseMediaMetadata(
  buffer: Buffer,
  mimeType: string,
): Promise<MediaMetadata> {
  const base: MediaMetadata = {
    type: mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "document",
    mimeType,
    size: buffer.length,
  };

  if (base.type === "image") {
    try {
      base.image = await parseImageMetadata(buffer);
    } catch {
      // Sharp can't parse this image format
    }
  }

  return base;
}

/** Check if image needs compression based on size/dimensions */
export async function shouldCompress(
  buffer: Buffer,
  maxSizeBytes = 5 * 1024 * 1024,
  maxDimension = 4096,
): Promise<boolean> {
  if (buffer.length > maxSizeBytes) return true;

  try {
    const metadata = await sharp(buffer).metadata();
    if (
      (metadata.width && metadata.width > maxDimension) ||
      (metadata.height && metadata.height > maxDimension)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

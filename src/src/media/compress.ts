import sharp from "sharp";

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "jpeg" | "webp" | "png";
}

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_QUALITY = 80;

/** Compress and resize an image buffer */
export async function compressImage(
  input: Buffer,
  options?: CompressOptions,
): Promise<Buffer> {
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_DIMENSION;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const format = options?.format ?? "jpeg";

  let pipeline = sharp(input).resize(maxWidth, maxHeight, {
    fit: "inside",
    withoutEnlargement: true,
  });

  switch (format) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality });
      break;
    case "png":
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
  }

  return pipeline.toBuffer();
}

/** Convert any image to WebP format */
export async function convertToWebP(
  input: Buffer,
  quality = DEFAULT_QUALITY,
): Promise<Buffer> {
  return sharp(input).webp({ quality }).toBuffer();
}

/** Generate a thumbnail from an image */
export async function generateThumbnail(
  input: Buffer,
  width = 320,
  height = 320,
): Promise<Buffer> {
  return sharp(input)
    .resize(width, height, { fit: "cover" })
    .jpeg({ quality: 70 })
    .toBuffer();
}

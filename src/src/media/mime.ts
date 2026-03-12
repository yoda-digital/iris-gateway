import { extname } from "node:path";

const EXTENSION_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".json": "application/json",
  ".zip": "application/zip",
};

const MAGIC_BYTES: Array<{ bytes: number[]; offset: number; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], offset: 0, mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0, mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0, mime: "image/gif" },
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: "image/webp" }, // RIFF (check WEBP later)
  { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0, mime: "application/pdf" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0, mime: "application/zip" },
  { bytes: [0x49, 0x44, 0x33], offset: 0, mime: "audio/mpeg" }, // ID3 tag
  { bytes: [0xff, 0xfb], offset: 0, mime: "audio/mpeg" },
  { bytes: [0x4f, 0x67, 0x67, 0x53], offset: 0, mime: "audio/ogg" },
  { bytes: [0x66, 0x4c, 0x61, 0x43], offset: 0, mime: "audio/flac" },
];

/** Detect MIME type from buffer magic bytes */
export function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  for (const entry of MAGIC_BYTES) {
    let match = true;
    for (let i = 0; i < entry.bytes.length; i++) {
      if (buffer[entry.offset + i] !== entry.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Distinguish RIFF-based formats
      if (entry.mime === "image/webp" && buffer.length >= 12) {
        const tag = buffer.subarray(8, 12).toString("ascii");
        if (tag === "WEBP") return "image/webp";
        if (tag === "AVI ") return "video/x-msvideo";
        return "application/octet-stream";
      }
      return entry.mime;
    }
  }

  // Check for MP4/M4A (ftyp box at offset 4)
  if (buffer.length >= 8) {
    const ftyp = buffer.subarray(4, 8).toString("ascii");
    if (ftyp === "ftyp") {
      const brand = buffer.subarray(8, 12).toString("ascii");
      if (brand.startsWith("M4A")) return "audio/mp4";
      return "video/mp4";
    }
  }

  return null;
}

/** Get MIME type from filename extension */
export function getMimeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return EXTENSION_MAP[ext] ?? "application/octet-stream";
}

/** Detect MIME type: try buffer first, fall back to filename */
export function detectMime(buffer: Buffer | null, filename?: string): string {
  if (buffer) {
    const detected = detectMimeFromBuffer(buffer);
    if (detected) return detected;
  }
  if (filename) return getMimeFromFilename(filename);
  return "application/octet-stream";
}

/** Get media category from MIME type */
export function getMediaType(mimeType: string): "image" | "video" | "audio" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

/** Get a reasonable file extension for a MIME type */
export function getExtensionForMime(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXTENSION_MAP)) {
    if (mime === mimeType) return ext;
  }
  return ".bin";
}

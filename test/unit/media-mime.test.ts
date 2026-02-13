import { describe, it, expect } from "vitest";
import {
  detectMimeFromBuffer,
  getMimeFromFilename,
  detectMime,
  getMediaType,
  getExtensionForMime,
} from "../../src/media/mime.js";

describe("media/mime", () => {
  describe("detectMimeFromBuffer", () => {
    it("detects JPEG from magic bytes", () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(8).fill(0)]);
      expect(detectMimeFromBuffer(buf)).toBe("image/jpeg");
    });

    it("detects PNG from magic bytes", () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(8).fill(0)]);
      expect(detectMimeFromBuffer(buf)).toBe("image/png");
    });

    it("detects GIF from magic bytes", () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, ...Array(8).fill(0)]);
      expect(detectMimeFromBuffer(buf)).toBe("image/gif");
    });

    it("detects PDF from magic bytes", () => {
      const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, ...Array(8).fill(0)]);
      expect(detectMimeFromBuffer(buf)).toBe("application/pdf");
    });

    it("returns null for unknown bytes", () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, ...Array(8).fill(0)]);
      expect(detectMimeFromBuffer(buf)).toBeNull();
    });

    it("returns null for too-short buffer", () => {
      const buf = Buffer.from([0xff, 0xd8]);
      expect(detectMimeFromBuffer(buf)).toBeNull();
    });
  });

  describe("getMimeFromFilename", () => {
    it("returns correct MIME for common extensions", () => {
      expect(getMimeFromFilename("photo.jpg")).toBe("image/jpeg");
      expect(getMimeFromFilename("photo.png")).toBe("image/png");
      expect(getMimeFromFilename("video.mp4")).toBe("video/mp4");
      expect(getMimeFromFilename("song.mp3")).toBe("audio/mpeg");
      expect(getMimeFromFilename("doc.pdf")).toBe("application/pdf");
    });

    it("returns octet-stream for unknown extensions", () => {
      expect(getMimeFromFilename("file.xyz")).toBe("application/octet-stream");
    });

    it("is case insensitive", () => {
      expect(getMimeFromFilename("PHOTO.JPG")).toBe("image/jpeg");
    });
  });

  describe("detectMime", () => {
    it("prefers buffer detection over filename", () => {
      const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(8).fill(0)]);
      expect(detectMime(jpegBuf, "file.png")).toBe("image/jpeg");
    });

    it("falls back to filename when buffer detection fails", () => {
      const unknownBuf = Buffer.from([0x00, 0x00, 0x00, 0x00, ...Array(8).fill(0)]);
      expect(detectMime(unknownBuf, "photo.png")).toBe("image/png");
    });

    it("returns octet-stream when nothing matches", () => {
      expect(detectMime(null, undefined)).toBe("application/octet-stream");
    });
  });

  describe("getMediaType", () => {
    it("categorizes MIME types correctly", () => {
      expect(getMediaType("image/jpeg")).toBe("image");
      expect(getMediaType("video/mp4")).toBe("video");
      expect(getMediaType("audio/mpeg")).toBe("audio");
      expect(getMediaType("application/pdf")).toBe("document");
      expect(getMediaType("text/plain")).toBe("document");
    });
  });

  describe("getExtensionForMime", () => {
    it("returns correct extension for known types", () => {
      expect(getExtensionForMime("image/jpeg")).toBe(".jpg");
      expect(getExtensionForMime("video/mp4")).toBe(".mp4");
    });

    it("returns .bin for unknown types", () => {
      expect(getExtensionForMime("application/x-custom")).toBe(".bin");
    });
  });
});

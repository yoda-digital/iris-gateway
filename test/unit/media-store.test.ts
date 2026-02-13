import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MediaStore } from "../../src/media/store.js";

describe("MediaStore", () => {
  let tempDir: string;
  let store: MediaStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iris-media-test-"));
    store = new MediaStore(tempDir);
  });

  afterEach(() => {
    store.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves and retrieves a file", async () => {
    const content = Buffer.from("hello world");
    const entry = await store.save(content, { filename: "test.txt" });

    expect(entry.id).toBeDefined();
    expect(entry.size).toBe(content.length);
    expect(entry.filename).toBe("test.txt");
    expect(entry.mimeType).toBe("text/plain");

    const retrieved = await store.get(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.toString()).toBe("hello world");
  });

  it("returns null for unknown id", async () => {
    expect(await store.get("nonexistent")).toBeNull();
  });

  it("deletes a file", async () => {
    const entry = await store.save(Buffer.from("data"), { filename: "del.txt" });
    expect(await store.delete(entry.id)).toBe(true);
    expect(await store.get(entry.id)).toBeNull();
  });

  it("returns false when deleting nonexistent file", async () => {
    expect(await store.delete("nonexistent")).toBe(false);
  });

  it("gets entry metadata", async () => {
    const entry = await store.save(Buffer.from("metadata test"), {
      filename: "meta.txt",
    });
    const info = await store.getEntry(entry.id);
    expect(info).not.toBeNull();
    expect(info!.id).toBe(entry.id);
    expect(info!.size).toBe(13);
  });

  it("detects MIME from buffer when no filename given", async () => {
    // JPEG magic bytes
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]);
    const entry = await store.save(jpeg);
    expect(entry.mimeType).toBe("image/jpeg");
  });

  it("cleans up old files", async () => {
    const shortTtlStore = new MediaStore(tempDir, 1); // 1ms TTL
    const entry = await shortTtlStore.save(Buffer.from("temp"), { filename: "tmp.txt" });

    await new Promise((r) => setTimeout(r, 50));
    const removed = await shortTtlStore.cleanup();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await shortTtlStore.get(entry.id)).toBeNull();
    shortTtlStore.dispose();
  });
});

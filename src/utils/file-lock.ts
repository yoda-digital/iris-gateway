import * as lockfile from "proper-lockfile";

export async function withFileLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, {
      retries: { retries: 3, minTimeout: 100 },
      realpath: false,
    });
    return await fn();
  } finally {
    await release?.();
  }
}

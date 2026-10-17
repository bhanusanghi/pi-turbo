import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SourceFailure } from "./contracts.js";

/** References are safe to persist. Values are resolved only in the collecting process. */
export function createSourceSecretResolver(read: (name: string) => string | undefined = name => process.env[name]) {
  return async (name: string): Promise<string> => {
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(name)) throw new SourceFailure("configuration", "Invalid secret reference");
    const value = read(name)?.trim();
    if (!value) throw new SourceFailure("configuration", `Missing credential reference ${name}`);
    if (!value.startsWith("file:")) return value;
    try {
      const path = resolve(value.slice(5));
      const stat = await lstat(path);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 65536) throw new Error("Invalid credential file");
      const secret = (await readFile(path, "utf8")).trim();
      if (!secret) throw new Error("Empty credential file");
      return secret;
    } catch { throw new SourceFailure("configuration", `Credential file for ${name} must be a private, nonempty regular file (chmod 600, at most 64 KiB)`); }
  };
}

export async function importSourceCredential(directory: string, name: string, from: string): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new SourceFailure("configuration", "Credential name must contain letters, numbers, underscores or hyphens");
  const secret = await readFile(from, "utf8").catch(() => { throw new SourceFailure("configuration", "Cannot read the supplied credential file"); });
  if (!secret.trim() || Buffer.byteLength(secret) > 65536) throw new SourceFailure("configuration", "Credential file must be nonempty and at most 64 KiB");
  const targetDir = resolve(directory, "credentials");
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const path = resolve(targetDir, `${name}.secret`);
  const file = await open(path, "wx", 0o600).catch(() => { throw new SourceFailure("configuration", "Credential name already exists or cannot be written; use a new name for rotation"); });
  try { await file.writeFile(secret); } finally { await file.close(); }
  return path;
}

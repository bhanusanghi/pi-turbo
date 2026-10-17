import { open } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const template = await Bun.file(new URL("../.env.example", import.meta.url)).text();
try {
  const file = await open(".env", "wx", 0o600);
  try { await file.writeFile(template.replace(/^API_TOKEN=.*$/m, `API_TOKEN=${randomBytes(32).toString("hex")}`)); }
  finally { await file.close(); }
  console.log("Created local .env with an operator token. Run bun run local. Existing provider accounts and destinations are not configured.");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") console.log("Kept existing .env. Run bun run local.");
  else throw error;
}

import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hash } from "./adapters.js";
import type { NewsConfig, NewsState, Portfolio } from "./types.js";
export const exposureRevision = (portfolio: Portfolio) => hash(portfolio.positions.map(p =>
  [p.wallet, p.kind, p.dex, p.coin, p.size, p.entryPrice]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
export const reviewKey = (revision: string, articleId: string, policy: string) => hash([revision, articleId, policy]);
export class NewsStore {
  private scope: string;
  constructor(readonly file: string, config: NewsConfig) { this.scope = hash([config.wallets, config.perpDexs, config.includeSpot, config.feeds]); }
  async read(): Promise<NewsState> {
    try {
      const state = JSON.parse(await readFile(this.file, "utf8")) as NewsState;
      if (state.version !== 1 || state.scope !== this.scope || !Array.isArray(state.articles) || !state.alerts || !state.reviewed) {
        throw new Error("Unsupported or differently scoped news state; choose another stateFile or migrate it explicitly");
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, scope: this.scope, articles: [], reviewed: {}, alerts: {} };
    }
  }
  async save(state: NewsState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(state, null, 2)); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temp, this.file); } finally { await unlink(temp).catch(() => {}); }
  }
  async locked<T>(work: (state: NewsState) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true });
    let handle;
    try { handle = await open(`${this.file}.lock`, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`News state locked: ${this.file}.lock. Inspect the other process or interrupted send before removing this lock.`);
      throw error;
    }
    try { await handle.writeFile(String(process.pid)); return await work(await this.read()); }
    finally { await handle.close(); await unlink(`${this.file}.lock`); }
  }
}

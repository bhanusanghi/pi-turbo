import { createStore } from "./storage/index.js";
import { connectionUrl } from "./config.js";
import { AppError } from "./contracts.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const store = createStore(connectionUrl(process.env.DATABASE_URL, "DATABASE_URL", ["postgres:", "postgresql:"]));
try { await store.migrate(); console.log("Portfolio monitor schema is current"); }
catch (error) { console.error(error instanceof AppError ? error.message : "Database migration failed"); process.exitCode = 1; }
finally { await store.close(); }

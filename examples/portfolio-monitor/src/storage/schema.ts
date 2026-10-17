import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Queryable identity/status columns; versioned provider/domain bodies remain JSON. */
export const resources = pgTable("pm_resources", {
  id: uuid("id").primaryKey(), kind: text("kind").notNull(), revision: integer("revision").notNull(),
  enabled: boolean("enabled").notNull(), body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, table => [index("pm_resources_kind_id").on(table.kind, table.id)]);
export const inputItems = pgTable("pm_input_items", {
  id: uuid("id").primaryKey(), sourceId: uuid("source_id").notNull().references(() => resources.id), sourceItemId: text("source_item_id").notNull(),
}, table => [uniqueIndex("pm_input_source_item").on(table.sourceId, table.sourceItemId)]);
export const inputRevisions = pgTable("pm_input_revisions", {
  id: uuid("id").primaryKey(), inputId: uuid("input_id").notNull().references(() => inputItems.id),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(), sourceId: uuid("source_id").notNull().references(() => resources.id),
  contentHash: text("content_hash").notNull(), sourceRevision: text("source_revision"), body: jsonb("body").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
});
export const evaluations = pgTable("pm_evaluations", {
  id: uuid("id").primaryKey(), sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  monitorId: uuid("monitor_id").notNull().references(() => resources.id), monitorRevision: integer("monitor_revision").notNull(),
  cutoffSequence: bigint("cutoff_sequence", { mode: "bigint" }).notNull(), status: text("status").notNull(),
  trigger: jsonb("trigger").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const dispatches = pgTable("pm_dispatches", {
  id: uuid("id").primaryKey(), sequence: bigint("sequence", { mode: "bigint" }).notNull(), queue: text("queue").notNull(),
  recordId: uuid("record_id").notNull(), availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }), attempts: integer("attempts").notNull(), error: text("error"),
});
export const sourceState = pgTable("pm_source_state", {
  sourceId: uuid("source_id").primaryKey().references(() => resources.id), checkpoint: jsonb("checkpoint"),
  sourceRevision: integer("source_revision").notNull(), connectionId: uuid("connection_id").notNull().references(() => resources.id), connectionRevision: integer("connection_revision").notNull(),
  status: text("status").notNull(), nextRunAt: timestamp("next_run_at",{withTimezone:true}), lastSuccessAt: timestamp("last_success_at",{withTimezone:true}), lastError: text("last_error"), lastCount: integer("last_count").notNull(), gap: boolean("gap").notNull(),
});
export const sourceSyncRequests = pgTable("pm_source_sync_requests", {
  id: uuid("id").primaryKey(), sourceId: uuid("source_id").notNull().references(() => resources.id), sourceRevision: integer("source_revision").notNull(),
  connectionId: uuid("connection_id").notNull().references(() => resources.id), connectionRevision: integer("connection_revision").notNull(), status:text("status").notNull(), dirty:boolean("dirty").notNull(), error:text("error"), createdAt:timestamp("created_at",{withTimezone:true}).notNull(), updatedAt:timestamp("updated_at",{withTimezone:true}).notNull(),
});

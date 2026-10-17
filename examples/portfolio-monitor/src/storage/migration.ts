/** One initial application schema. Version is committed together with DDL under a migration lock. */
export const migration = `
CREATE TABLE IF NOT EXISTS pm_schema_version(version integer PRIMARY KEY);
CREATE TABLE pm_resources (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('sources','accounts','portfolios','monitors','destinations')),
 revision integer NOT NULL CHECK(revision > 0), enabled boolean NOT NULL, body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_resources_kind_id ON pm_resources(kind,id);
CREATE TABLE pm_memberships (
 owner_id uuid NOT NULL REFERENCES pm_resources(id), relation text NOT NULL CHECK(relation IN ('account','source','destination','portfolio')),
 target_id uuid NOT NULL REFERENCES pm_resources(id), PRIMARY KEY(owner_id,relation,target_id)
);
CREATE INDEX pm_memberships_target ON pm_memberships(target_id,relation);
CREATE TABLE pm_idempotency (
 operation text NOT NULL, key text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(operation,key)
);
CREATE TABLE pm_input_items (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES pm_resources(id), source_item_id text NOT NULL,
 UNIQUE(source_id,source_item_id)
);
CREATE TABLE pm_input_revisions (
 id uuid PRIMARY KEY, input_id uuid NOT NULL REFERENCES pm_input_items(id), sequence bigserial UNIQUE NOT NULL,
 source_id uuid NOT NULL REFERENCES pm_resources(id), content_hash text NOT NULL, source_revision text,
 body jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pm_input_provider_revision ON pm_input_revisions(input_id,source_revision) WHERE source_revision IS NOT NULL;
CREATE INDEX pm_input_revisions_item ON pm_input_revisions(input_id,sequence);
CREATE INDEX pm_input_revisions_source ON pm_input_revisions(source_id,sequence);
CREATE TABLE pm_input_provider_revisions (
 input_id uuid NOT NULL REFERENCES pm_input_items(id), provider_revision text NOT NULL,
 content_hash text NOT NULL, revision_id uuid NOT NULL REFERENCES pm_input_revisions(id),
 PRIMARY KEY(input_id,provider_revision)
);
CREATE TABLE pm_evaluations (
 id uuid PRIMARY KEY, sequence bigserial UNIQUE NOT NULL, monitor_id uuid NOT NULL REFERENCES pm_resources(id),
 monitor_revision integer NOT NULL, cutoff_sequence bigint NOT NULL, status text NOT NULL CHECK(status='awaiting_evaluator'),
 trigger jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_evaluations_monitor ON pm_evaluations(monitor_id,sequence);
CREATE TABLE pm_refresh_requests (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES pm_resources(id), account_revision integer NOT NULL,
 reason text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','completed','failed')),
 dirty boolean NOT NULL DEFAULT false, snapshot_id uuid, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pm_one_active_refresh ON pm_refresh_requests(account_id) WHERE status IN ('queued','running');
CREATE TABLE pm_account_snapshots (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES pm_resources(id), account_revision integer NOT NULL,
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_account_snapshots_latest ON pm_account_snapshots(account_id,created_at DESC,id DESC);
ALTER TABLE pm_refresh_requests ADD CONSTRAINT pm_refresh_snapshot_fk FOREIGN KEY(snapshot_id) REFERENCES pm_account_snapshots(id);
CREATE TABLE pm_portfolio_snapshots (
 id uuid PRIMARY KEY, portfolio_id uuid NOT NULL REFERENCES pm_resources(id), portfolio_revision integer NOT NULL,
 exposure_revision text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_portfolio_snapshots_latest ON pm_portfolio_snapshots(portfolio_id,created_at DESC,id DESC);
CREATE TABLE pm_deliveries (
 id uuid PRIMARY KEY, destination_id uuid NOT NULL REFERENCES pm_resources(id), destination_revision integer NOT NULL,
 body jsonb NOT NULL, status text NOT NULL CHECK(status IN ('queued','sending','previewed','sent','rejected','unknown')),
 rendered_text text, receipt jsonb, error text, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pm_deliveries_status ON pm_deliveries(status,created_at);
CREATE TABLE pm_dispatches (
 id uuid PRIMARY KEY, sequence bigserial UNIQUE NOT NULL,
 queue text NOT NULL CHECK(queue IN ('portfolio.refresh','evaluation.run','notification.deliver')),
 record_id uuid NOT NULL, available_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, error text
);
CREATE INDEX pm_dispatches_pending ON pm_dispatches(sequence) WHERE dispatched_at IS NULL;
INSERT INTO pm_schema_version(version) VALUES (1);
`;

/** Snapshot ordering uses insertion time, rather than a transaction's earlier start time. */
export const migrationV2 = `
ALTER TABLE pm_resources ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_resources ALTER COLUMN updated_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_idempotency ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_input_revisions ALTER COLUMN received_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_evaluations ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_refresh_requests ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_refresh_requests ALTER COLUMN updated_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_account_snapshots ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_portfolio_snapshots ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_deliveries ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_deliveries ALTER COLUMN updated_at SET DEFAULT clock_timestamp();
ALTER TABLE pm_dispatches ALTER COLUMN available_at SET DEFAULT clock_timestamp();
INSERT INTO pm_schema_version(version) VALUES(2);
`;

/** Application source collection state. Independent of Pi conversation persistence. */
export const migrationV3 = `
ALTER TABLE pm_resources DROP CONSTRAINT pm_resources_kind_check;
ALTER TABLE pm_resources ADD CONSTRAINT pm_resources_kind_check CHECK(kind IN ('connections','sources','accounts','portfolios','monitors','destinations'));
ALTER TABLE pm_dispatches DROP CONSTRAINT pm_dispatches_queue_check;
ALTER TABLE pm_dispatches ADD CONSTRAINT pm_dispatches_queue_check CHECK(queue IN ('portfolio.refresh','evaluation.run','notification.deliver','source.sync'));
CREATE TABLE pm_source_state (
 source_id uuid PRIMARY KEY REFERENCES pm_resources(id), checkpoint jsonb,
 source_revision integer NOT NULL, connection_id uuid NOT NULL REFERENCES pm_resources(id), connection_revision integer NOT NULL,
 status text NOT NULL CHECK(status IN ('idle','queued','running','backoff','auth_required','error','disabled','gap')),
 next_run_at timestamptz, last_success_at timestamptz, last_error text,
 last_count integer NOT NULL DEFAULT 0, gap boolean NOT NULL DEFAULT false
);
CREATE INDEX pm_source_state_connection ON pm_source_state(connection_id);
CREATE TABLE pm_source_sync_requests (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES pm_resources(id),
 source_revision integer NOT NULL, connection_id uuid NOT NULL REFERENCES pm_resources(id), connection_revision integer NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed')), dirty boolean NOT NULL DEFAULT false,
 error text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX pm_one_active_source_sync ON pm_source_sync_requests(source_id) WHERE status IN ('queued','running');
INSERT INTO pm_schema_version(version) VALUES(3);
`;

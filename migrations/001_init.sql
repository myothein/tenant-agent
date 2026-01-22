CREATE TABLE IF NOT EXISTS outbox (
                                      id TEXT PRIMARY KEY,
                                      tenant_id TEXT NOT NULL,
                                      aggregate_type TEXT NOT NULL,
                                      aggregate_id TEXT NOT NULL,
                                      event_type TEXT NOT NULL,
                                      payload TEXT NOT NULL,
                                      occurred_at TEXT NOT NULL
);

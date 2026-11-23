# Production readiness gates — tenant-agent

**Status: NO-GO.** This proposed branch addresses source-control hygiene only. It is **not** a production certification.

## Mandatory pre-merge checks

- [ ] Arrange independent, verified backup of all runtime tenant databases, logs and original configuration. Removing tracked files from a branch must not erase the only copy of operational evidence.
- [ ] Review and rotate/revoke any potentially committed live credentials, and provision secret-manager environment injection. A Git commit deletion does **not** remove secrets or data from past Git history, forks or caches. History cleanup requires separately approved coordination.
- [ ] Generate and commit a pinned dependency lockfile; run clean reproducible dependency install and production build.
- [ ] Add unit/integration tests, verify cross-service API and DB contracts, and collect pass/fail evidence.
- [ ] Prove least-privilege authorization, auditability, tenant isolation, zero hard-coded production credentials, and recovery after restart.
- [ ] Complete service-specific blockers:
- [ ] Safe backup and verified restore of runtime SQLite data before any merge
- [ ] Preserve event IDs and prove idempotent retries
- [ ] System API route/schema compatibility with central-service
- [ ] Windows agent start-up, controlled shutdown and crash recovery
- [ ] Protected local credential storage and TLS validation
- [ ] Require independent review, security scan, signed artifacts where applicable, restore drill and approved release go/no-go.

Do not integrate with UIMS V1 until the six infrastructure repositories pass their release gates. No production deployment is authorized by this PR.

## CI verification scope

The initial CI jobs check tracked-file hygiene, dependency lockfile presence, clean npm installation and TypeScript compilation. A successful result **does not** prove authentication, database migrations, offline data safety, functional tests, device integration, signing, or production readiness. Keep the PR as draft until independent release criteria pass.


## 2026-11-23 — Outbox tenant isolation and retry safety

- **Agent-side fail-closed tenant scope:** Central event and heartbeat methods verify their requested tenant is exactly the deployment's configured \`TENANT_ID\` before contacting the network. The Central Service's own tenant-scoped bearer-key validation remains mandatory; this check is defense in depth, not a replacement.
- **Corrupt/stale SQLite row isolation:** Both the canonical \`LocalEventsSyncService\` and older \`SyncService\` refuse to send any outbox record whose tenant differs from the current agent tenant. The record stays unsent, unchanged for controlled quarantine/recovery; valid own-tenant records continue to synchronize.
- **Bounded retries:** The two flush implementations reject invalid batch sizes (zero, negative, non-integer, or over 100), preventing an infinite loop for batch size 0.
- **Credential header precedence:** Scoped Central agent credentials are assigned after caller-provided headers and cannot be replaced by options.
- Regression tests exercise wrong-tenant Central event/heartbeat rejection without any HTTP requests, mixed-tenant SQLite outboxes with intact own-tenant delivery, and invalid batch sizes on native SQLite.

### Release constraints
- Corrupt/misrouted records require an authorized quarantine review/repair process. Do not silently delete or reassign events to different tenants.
- Production SQLite migration/backup/restore, Windows ACLs and storage encryption, power-loss durability, replay at scale, tenant key rotation, eventual retry policy, secure transport identity, and real external Keycloak/authorization remain **unverified**.
- The full-sync CI suite uses **pinned synthetic service revisions**, not proof of UIMS V1 compatibility or live production operational acceptance.
- All six repositories remain **PRODUCTION NO-GO** pending separate approval, privacy/secret exposure remediation and independent end-to-end release gates.

No live service, production database, or UIMS V1 source was changed.

## 2026-11-23 — Bounded canonical SQLite flush and private-log guard (Draft)

- The running service's canonical `LocalEventsSyncService.flushOutbox(batchSize)` no longer calls `SELECT * FROM outbox WHERE sent=0` and reads **every unsent record** into application memory. It now snapshots a SQLite `rowid` high-water mark and reads at most `batchSize` rows per SQL query, ordered by rowid. Failed and cross-tenant rows are examined once per invocation without looping forever; newly appended records are deferred to the next invocation.
- The event payload is never included in the invalid-source diagnostic, even if the source serialization creates an undefined column value. The SQLite event is not acknowledged upstream if the outbox insert cannot be validated.
- Windows-native SQLite regression fixtures cover a 35-event outbox with a 7-record query bound, an event appended during a flush, its deferred delivery on the next flush, and a deliberately malformed source fixture with a synthetic private-value sentinel that must not appear in captured error logs.
- **Explicit scope:** This change is in the running `LocalEventsSyncService` only. The older manual `SyncService` CLI implementation still needs a separate bounded-paging/privacy review. Large-scale throughput, disk-full behavior, filesystem ACL/encryption, native backup/restore drills, power-loss fsync and off-host disaster recovery have **not** been accepted.
- GitHub Actions provide isolated QA evidence, not production approval. Keep the feature in the Draft PR with no production deployment or merge until signed-off release gating.

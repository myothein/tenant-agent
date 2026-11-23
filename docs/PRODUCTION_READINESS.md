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
- **Explicit scope:** This change is in the running `LocalEventsSyncService` only. The older manual `SyncService` CLI has since been updated to use bounded pages and to retain malformed JSON rows for authorized review; its periodic legacy scheduling path still needs a separate lifecycle review. Large-scale throughput, disk-full behavior, filesystem ACL/encryption, native backup/restore drills, power-loss fsync and off-host disaster recovery have **not** been accepted.
- GitHub Actions provide isolated QA evidence, not production approval. Keep the feature in the Draft PR with no production deployment or merge until signed-off release gating.

### 2026-11-23 — Manual CLI outbox reliability and error disclosure guard (Draft)

- `SyncService.flushOutbox()`, reached by the manual `tenant-agent sync` command, now pages SQLite unsent rows by bounded `rowid` with a finite high-water mark. It no longer reads and parses every unsent event into memory in one call.
- Malformed SQLite JSON no longer prevents other healthy event rows from being sent; the malformed record stays queued and is **never printed** in error diagnostics. The affected row is not silently deleted or acknowledged.
- Central transport failures are logged in generic form rather than printing raw error objects, which can include sensitive URLs or request metadata. The manual CLI closes its SQLite handle in a `finally` block and reports only the number of delivered events—not a blanket success claim for the whole queue.
- Native Windows SQLite regression tests cover multi-page delivery, a corrupt synthetic source row with a private-data canary, preserving the unacknowledged row, and deferring an event added during the flush until its next invocation.
- **Still open:** service lifecycle acceptance for the legacy scheduled sync mode, strict OS filesystem ACL, real TLS/mTLS provisioning, disk-full handling, off-host backup restore, production credential rotation, and bounded retry/backoff policy. Draft-only, no main merge or production changes.

## 2026-11-23 — WAL FULL sync and no automatic deletion (Draft QA)

- Both the canonical `LocalEventsSyncService` and legacy/manual `SyncService` configure their SQLite connections with `journal_mode=WAL`, `synchronous=FULL`, and a bounded 5-second busy timeout. They fail closed if WAL or synchronous FULL is unavailable instead of acknowledging upstream messages under weaker settings. These pragmas apply **to each connection**; the journal mode persists on disk, whereas the synchronous setting must be asserted on every new connection.
- The canonical outbox acknowledges a tenant-service source event only after its SQLite write returns successfully. Windows regression tests exercise a synthetic pending source record, close/reopen the database, check the same UUID and pending state, switch to the manual writer, and validate SQLite native backup with `PRAGMA integrity_check`.
- The service startup's automatic hourly deletion of `sent=1` rows is **disabled**. It previously used the source `createdAt` timestamp rather than an independently verified delivery/retention age; an old event delivered today could therefore have been removed immediately at the next hourly cleanup. Manual `cleanSentEvents()` is not automatically invoked. Retention and purge must be separately approved and backed by a confirmed-delivery timestamp, secure backup and replay/receipt policy.
- **Still unverified:** actual power-loss/fsync durability of the host hardware and controller, encrypted Windows volume, filesystem ACLs, off-host restored backup, SSD cache behavior, SQLite disk-full recovery, real workload identity and credential rotation. WAL/FULL and passing CI are not a production reliability certification. No live data or production startup settings were changed.

## 2026-11-23 — Verified, non-overwriting SQLite backup publication (Draft QA)

- Both the canonical daemon (`LocalEventsSyncService`) and manual (`SyncService`) now use the same native SQLite backup procedure: write into a unique staging directory **on the target filesystem**, open that staged snapshot read-only, run `PRAGMA integrity_check`, confirm the `outbox` table and every expected column, and only then atomically create a hard link to the desired final backup filename.
- If the final filename already exists, creation fails without overwriting the prior verified recovery point. Failed/incomplete staging directories are cleaned up. A final filename is **never** published before complete verification. The target directory must be created and access-controlled by a trusted operator; do not accept backup paths from network requests.
- Disposable Windows SQLite tests check preserved source UUID/unsent state, a destination-name collision with no overwrite, temporary-file cleanup, rejection of corrupt or wrong-schema snapshots, and a **new isolated restore directory** reopened using the actual agent service with duplicate source replay.
- An hourly backup written under local `backups/` is still **not an off-host backup** and is not independently protected from host failure, ransomware or disk corruption. Retention, backup encryption, Windows NTFS ACL/DPAPI policy, authenticated transfer, immutable/offsite copies, restore exercises on approved hardware, RPO/RTO, and power-loss trials remain owner-approval release gates.
- **Production status:** NO-GO. The changes are on the existing Draft PR only; the CI suite uses temporary synthetic outboxes. Do not treat successful backup integrity tests as authorization to enable production or change live backup destinations.

## 2026-11-23 — Fail-closed production backup path policy

- Service startup now calls `prepareAgentBackupDirectory` **before opening the SQLite outbox or starting polling**. Production (`NODE_ENV=production`) requires an explicitly configured, absolute `TENANT_AGENT_BACKUP_DIR`, pointing to an **already existing** directory outside the agent process working tree. The service does not create the production directory, which must have pre-reviewed restricted filesystem ACLs and access to encrypted storage.
- Directory paths are checked using the resolved filesystem location, so a path redirected by a symlink back into the working tree cannot silently become the snapshot destination. The backup directory is verified again before every hourly/shutdown backup. Invalid or missing paths fail closed with a generic error that does not expose private filesystem paths.
- For nonproduction test/development only, an unset setting retains the previous isolated `./backups` fallback. No change is made to existing real deployment directories or contents by this Draft PR.
- Native tests cover unset/empty/malformed/relative production configuration, disallowed application-root backups, a properly pre-provisioned external directory, non-existent destinations that must not be automatically created in production, and a real child process startup that refuses an unprovisioned destination before opening its SQLite outbox.
- **Owner-run preproduction acceptance:** Provision a dedicated absolute directory with restricted NTFS ACLs for the actual service identity, verify disk encryption and anti-ransomware/offsite replication, configure `TENANT_AGENT_BACKUP_DIR` at the Windows service level, confirm successful startup backup and hourly snapshot, transfer and restore off-host, and document RPO/RTO. A path outside the application folder is NOT in itself sufficient to prove encryption or off-host backup.
- This remains code/QA-only, without modifying live Windows service configuration, runtime directories, GitHub repository privacy, production data or UIMS integration. **PRODUCTION NO-GO**.

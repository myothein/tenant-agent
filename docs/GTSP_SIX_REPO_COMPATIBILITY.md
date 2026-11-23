# GTSP V1 — Six Repository Compatibility and Release Gate Matrix

**Snapshot:** 2026-11-23 (Myanmar local)  
**Scope:** Existing GitHub repositories under `myothein`, existing draft hardening PRs only.  
**Release:** **PRODUCTION NO-GO — 0/6 accepted**.

## Audited source checkpoints

| Component | Exact reviewed revision | Verified synthetic CI |
| --- | --- | --- |
| central-service | `d423d9fee7f3d382be8072f85cd98fc64be087e3` | https://github.com/myothein/central-service/actions/runs/45089375818 |
| tenant-service | `db138df1f65d3b39646106c884409129ec8f5f6d` | https://github.com/myothein/tenant-service/actions/runs/45088141628 |
| db-helper | `cd99b4508ba4674110484527525ad9b172618b4a` | https://github.com/myothein/db-helper/actions/runs/45092347091 |
| tenant-agent | `f260e87ef15e3bd1b714957f808d45ae064a641c` (latest six-repo Windows/Node installer pin; docs-only commits afterwards) | https://github.com/myothein/tenant-agent/actions/runs/45097648322 |
| agentctl | `dfbe9954b27cbf14ae44173a80ca23e72199acb3` (actual Windows SCM offline/replay + restrictive NTFS ACL acceptance) | https://github.com/myothein/agentctl/actions/runs/45100610690 |
| central-cli | `e3c78a06991c9c64c39a5d57f7297605aa37a3f9` | https://github.com/myothein/central-cli/actions/runs/45089801483 |

All revisions above are immutable commit identifiers, not moving branch tags. Their individual test outcomes are NOT equivalent to a six-component production acceptance.

## Confirmed interaction paths

| Interaction / critical behavior | QA result | Source |
| --- | --- | --- |
| tenant-service Subject POST -> PostgreSQL local_events -> tenant-agent native SQLite -> central-service PostgreSQL event receipt | PASS, ephemeral PostgreSQL 17 and native SQLite | tenant-agent latest E2E run |
| Original UUID retry and central duplicate event idempotence; offline/missing-key recovery | PASS, synthetic scenarios | tenant-agent latest E2E run |
| Wrong tenant Central agent credential, agent-as-admin credential reuse and tenant-header spoofing | DENIED as expected, synthetic scenarios | tenant-agent latest E2E run |
| Existing Central event UUID replayed with mutated contents | HTTP 409; original persisted PostgreSQL payload unchanged | tenant-agent latest E2E run |
| Versioned db-helper system/tenant/local-event migrations applied into fresh isolated PostgreSQL databases | PASS as part of E2E; three migration files pinned to db-helper revision | tenant-agent latest E2E run |
| central-cli signed RS256 JWT against OIDC-hardened central-service and disposable PostgreSQL 17 | PASS with local mock JWKS / synthetic token, NOT real Keycloak | central-cli own CI run |
| **Same-database five-repository QA:** compiled Central CLI process lists the tenant used by the PostgreSQL → SQLite → PostgreSQL event pipeline, validates OIDC and rejects TENANT_ADMIN-only token | PASS with real Central API and shared disposable PostgreSQL 17 fixture; no real Keycloak | tenant-agent five-repository E2E run https://github.com/myothein/tenant-agent/actions/runs/45095066247 |
| agentctl signed artifact verification, simulated rollback and disposable Windows NSSM/SCM start/stop/rollback | PASS on hosted Windows QA, NOT production Windows server | agentctl own CI run |
| **Same hosted Windows runner:** actual tenant-agent Node process offline/restart/SQLite restore test; pinned agentctl build and safety regression tests; cross-repo installer prerequisite check | **PASS**, but actual signed tenant-agent.exe packaging ABSENT; agentctl refuses service install before NSSM/SCM operations | tenant-agent six-repo CI https://github.com/myothein/tenant-agent/actions/runs/45095727438 |
| **Genuine Windows SCM runtime:** Node 22 tenant-agent installed through reviewed opt-in `agentctl installNewService` and NSSM, SQLite persists offline event, SCM stop/restart, Central recovery delivery, idempotent replay | **PASS** on disposable GitHub-hosted Windows runner. Signed production artifact/ACL acceptance still OPEN | agentctl https://github.com/myothein/agentctl/actions/runs/45097352354 |
| Combined six-program installation and single host/distributed deployment | **NOT TESTED** | Outstanding |
| Real Keycloak, Windows production deployment, live data migration, encrypted backup/restore and UIMS V1 integration | **NOT TESTED** | Outstanding |

## Identity and data contracts

- Central Admin authentication: signed OIDC/JWKS access token with a realm-wide `CENTRAL_ADMIN` role. Static admin secret is QA-only and explicitly disabled in production.
- Tenant Admin authentication: signed OIDC/JWKS with an issuer, audience, role and deployment-specific `tenant_id`. QA-only legacy key exists behind explicit test-mode gates; agents use a separate scoped key.
- Central agent transport: distinct per-tenant machine keys and immutable source event UUIDs; active tenant and exact accepted/duplicate acknowledgment required before outbox deletion.
- PostgreSQL tenant isolation: separately scoped tenant database roles and immutable SQL migrations; production DB provisioning and destructive restores remain disabled pending controlled acceptance.
- Signed Windows updates: agentctl staged verification and rollback QA do not authorize an in-place production update.

## Windows packaging progress and remaining release blocker

The default `agentctl install` mode still expects a separately supplied `tenant-agent.exe`, which the TypeScript application does **not** produce. The new **opt-in** `agentctl install --node-runtime` mode instead launches the existing Node 22 `dist/index.js` through NSSM using a reviewed entry path, protected config-file path, and separate `ProgramData` working directory. Its installer validates version/prerequisites and refuses existing services; argument injection and setup rollback regression tests pass.

**Real hosted Windows SCM acceptance PASS:** a compiled genuine tenant-agent (not synthetic worker) was staged with its native SQLite dependencies and run under an actual NSSM/SCM service. The CI tested SQLite persistence while Central is offline, real Windows service stop/restart, delivery after recovery and duplicate replay without extra central records. https://github.com/myothein/agentctl/actions/runs/45097352354

**Still NO-GO:** no production-signed/reproducible Node runtime/application/native-dependencies/NSSM distribution, verified Windows service identity and NTFS ACLs, protected production config custody, live server recovery and backup-restore drills, operator-approved installation/rollback, or real Keycloak validation. Windows CI synthetic HTTP fixtures are not a replacement for an entire six-program production-equivalent deployment. See `myothein/agentctl/docs/WINDOWS_NODE_SERVICE_INSTALL_ACCEPTANCE.md`.

## Windows NTFS ACL security acceptance (hosted QA)

The audited `agentctl` revision now checks private config/runtime ACLs, application and NSSM/Node write permissions, and reparse-point paths **before** any Windows SCM operation. GitHub-hosted QA intentionally grants the `BUILTIN\\Users` group read access to a synthetic config file and verifies a **zero-NSSM-call rejection**. When the runner instead stages SHA-256-matched binaries in restricted Program Files with SYSTEM/Administrators access only, the genuine tenant-agent starts, safely queues an offline SQLite event, survives SCM stop/restart, and performs idempotent Central replay. Verified: https://github.com/myothein/agentctl/actions/runs/45100610690 .

This is a **source-level cross-repository compatibility check**, not a live full six-program installation or production Windows permissions acceptance. Trusted publisher signatures, recursive module file integrity, least-privilege service identity, WAL/log/backup ACLs, real Keycloak, off-host restore, and private GitHub CI access remain open.

## Cross-repository GitHub CI privacy requirement

The integration currently checks out public service repositories and downloads immutable db-helper migration SQL from public raw GitHub. **Private repository visibility will break these public fetches** unless the authorized owner configures a least-privilege cross-repository GitHub App token for read-only checkouts and replaces the raw fetch with an authenticated pinned db-helper checkout. Do not commit credentials, rely on cross-repository default `GITHUB_TOKEN` access, or expose a privileged installation token to untrusted PRs. Close this blocker before any privacy migration / release CI claim.

## Required closure before any merge/deploy

1. Make all six repositories private with verified owner permissions and assess the old public `.env` and history/forks/caches exposure. Rotate/revoke **potentially exposed live** credentials through an approved incident workflow. Never share them in a PR.
2. Establish signed/reproducible release artifacts, trusted update channels, reviewed dependency lockfiles and enforced branch protections.
3. Exercise real Keycloak login, audience/role/tenant claims, token expiry and revocation, least privilege, rotation and operator audit events.
4. Prove full schema migration/rollback and data retention, backup encryption, independently verified off-host restore and disaster recovery in production-equivalent Windows/Linux staging.
5. Build and validate the **complete six-component deployment** with real management CLI operations, signed Windows runtime/application distribution, Offline-first recovery, actual tenant isolation and cross-component version gates.
6. Only after independent QA/security approval and signed release GO may the separate UIMS V1 integration work start.

**Constraints:** Do not merge drafts or mutate `main`, rewrite Git history, access production databases, change Windows services, deploy or touch UIMS V1 without explicit permission.

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
| tenant-agent | `680c1e320ecf22df21aa23630d86bac0e780bac3` (latest four-component runtime E2E code checkpoint; subsequent documentation edits only) | https://github.com/myothein/tenant-agent/actions/runs/45094625388 |
| agentctl | `cf3b3c2ff733824f8c99438b9ff02063d3e6fb1d` | https://github.com/myothein/agentctl/actions/runs/45091030970 |
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
| agentctl signed artifact verification, simulated rollback and disposable Windows NSSM/SCM start/stop/rollback | PASS on hosted Windows QA, NOT production Windows server | agentctl own CI run |
| Combined six-program installation and single host/distributed deployment | **NOT TESTED** | Outstanding |
| Real Keycloak, Windows production deployment, live data migration, encrypted backup/restore and UIMS V1 integration | **NOT TESTED** | Outstanding |

## Identity and data contracts

- Central Admin authentication: signed OIDC/JWKS access token with a realm-wide `CENTRAL_ADMIN` role. Static admin secret is QA-only and explicitly disabled in production.
- Tenant Admin authentication: signed OIDC/JWKS with an issuer, audience, role and deployment-specific `tenant_id`. QA-only legacy key exists behind explicit test-mode gates; agents use a separate scoped key.
- Central agent transport: distinct per-tenant machine keys and immutable source event UUIDs; active tenant and exact accepted/duplicate acknowledgment required before outbox deletion.
- PostgreSQL tenant isolation: separately scoped tenant database roles and immutable SQL migrations; production DB provisioning and destructive restores remain disabled pending controlled acceptance.
- Signed Windows updates: agentctl staged verification and rollback QA do not authorize an in-place production update.

## Required closure before any merge/deploy

1. Make all six repositories private with verified owner permissions and assess the old public `.env` and history/forks/caches exposure. Rotate/revoke **potentially exposed live** credentials through an approved incident workflow. Never share them in a PR.
2. Establish signed/reproducible release artifacts, trusted update channels, reviewed dependency lockfiles and enforced branch protections.
3. Exercise real Keycloak login, audience/role/tenant claims, token expiry and revocation, least privilege, rotation and operator audit events.
4. Prove full schema migration/rollback and data retention, backup encryption, independently verified off-host restore and disaster recovery in production-equivalent Windows/Linux staging.
5. Build and validate the **complete six-component deployment** with real management CLI operations, Windows signed binaries, Offline-first recovery, actual tenant isolation and cross-component version gates.
6. Only after independent QA/security approval and signed release GO may the separate UIMS V1 integration work start.

**Constraints:** Do not merge drafts or mutate `main`, rewrite Git history, access production databases, change Windows services, deploy or touch UIMS V1 without explicit permission.

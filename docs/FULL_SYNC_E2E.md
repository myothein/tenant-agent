# Cross-repository full synchronization (CI-only)

This test exercises actual compiled code and real HTTP, PostgreSQL 17 and native SQLite:

1. tenant-service Subject API creates a subject with an atomic local_events outbox record.
2. tenant-agent polls via its scoped agent credential, preserving the source UUID in a durable SQLite outbox.
3. tenant-agent sends to central-service using a separate tenant-specific Central agent credential.
4. central-service persists the event in a separate ephemeral PostgreSQL database before returning acceptance.
5. The test simulates replay after central commit but before local sent marker, checks deduplication, simulates a missing central credential, verifies no event loss, retries, and checks persisted heartbeat server time.
6. A pinned, compiled **central-cli** binary runs `tenant list` as a real child process against the **same Central Service and PostgreSQL 17 database** using a short-lived, ephemeral RS256 signed OIDC token. Its JWKS is served by a temporary local issuer. A `TENANT_ADMIN`-only role is denied with HTTP 403; the token is not printed.

Pinned code under test:
- tenant-service: db138df1f65d3b39646106c884409129ec8f5f6d
- central-service: d423d9fee7f3d382be8072f85cd98fc64be087e3
- db-helper migrations: cd99b4508ba4674110484527525ad9b172618b4a
- central-cli: e3c78a06991c9c64c39a5d57f7297605aa37a3f9

All databases, tokens, and subjects are CI-only synthetic fixtures. No production or UIMS data is accessed. A green CI does not replace identity, hardware/Windows service testing, data retention, encryption, threat modeling, historical secret revocation, failover exercises or release approval. Production NO-GO.


## Hardened revision integration — 23 November 2026

The full-sync GitHub workflow now tests immutable audited peer versions, rather than older service versions. Synthetic tenant admin authentication is configured as explicit `NODE_ENV=test`, `TENANT_ADMIN_AUTH_MODE=legacy`, and `TENANT_ALLOW_DEV_API_KEY=true`; these options are **not allowed in production**. Central management login continues to default to OIDC, and Central event delivery uses a separate tenant-scoped agent key.

Additional negative end-to-end cases assert that a tenant A agent key cannot write an event claiming tenant B, a Central agent key cannot authorize Tenant Admin subject creation, and tenant header spoofing cannot switch a tenant-service instance to another tenant. After a refused Central event, PostgreSQL must contain no such event row. The E2E also reuses a previously committed event UUID with altered content, verifies an HTTP 409 collision response, and proves the original PostgreSQL event payload remains unchanged.

**Verified new service-version CI:** https://github.com/myothein/tenant-agent/actions/runs/45094625388 — clean build, Windows native SQLite, PostgreSQL 17 / SQLite / Central PostgreSQL E2E, and scoped-identity negatives all passed on the tested commit. Repository hygiene: https://github.com/myothein/tenant-agent/actions/runs/45094317770 .

## Five-repository fixture: management CLI + offline event pipeline

**Latest verified source code checkpoint:** `a291d489372f61f920d87b54e0cafe29fba17060`  
**GitHub-hosted QA evidence:** https://github.com/myothein/tenant-agent/actions/runs/45095066247 — dependency bootstrap, TypeScript security/unit tests, Windows native SQLite and PostgreSQL 17 end-to-end **all PASS**.

This is an integration of five repository **sources**: tenant-service, tenant-agent, central-service, central-cli, and db-helper's versioned migration SQL. It executes four application programs against ephemeral PostgreSQL 17, SQLite and a local synthetic JWKS issuer, not a production deployment. The CLI uses the exact Central DB already populated for the event transport; it does not use a separate mock Central API. Central verifies JWT signature, issuer, audience, expiry and realm-wide `CENTRAL_ADMIN` role. The test intentionally denies a signed token having only `TENANT_ADMIN`.

**Still not tested together:** `agentctl` Windows service lifecycle is independently covered by disposable Windows NSSM/SCM tests, not launched in this Linux PostgreSQL E2E. No live Keycloak, production token acquisition, GitHub-private cross-repository access, on-host recovery, signed artifacts, off-host backup restoration or UIMS compatibility is certified.

**Privacy migration warning:** This E2E currently checks out other public repositories with ordinary read-only checkout and downloads pinned db-helper migration SQL from the public raw GitHub endpoint. Once the repositories become private, those fetches need an approved read-only GitHub App installation token and authenticated checkout of the exact db-helper commit. Do not use personal credentials in workflow files, widen `GITHUB_TOKEN` permissions, or claim private CI continuity until that separate change is tested.

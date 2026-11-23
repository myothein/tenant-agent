# Cross-repository full synchronization (CI-only)

This test exercises actual compiled code and real HTTP, PostgreSQL 17 and native SQLite:

1. tenant-service Subject API creates a subject with an atomic local_events outbox record.
2. tenant-agent polls via its scoped agent credential, preserving the source UUID in a durable SQLite outbox.
3. tenant-agent sends to central-service using a separate tenant-specific Central agent credential.
4. central-service persists the event in a separate ephemeral PostgreSQL database before returning acceptance.
5. The test simulates replay after central commit but before local sent marker, checks deduplication, simulates a missing central credential, verifies no event loss, retries, and checks persisted heartbeat server time.

Pinned code under test:
- tenant-service: db138df1f65d3b39646106c884409129ec8f5f6d
- central-service: d423d9fee7f3d382be8072f85cd98fc64be087e3
- db-helper migrations: cd99b4508ba4674110484527525ad9b172618b4a

All databases, tokens, and subjects are CI-only synthetic fixtures. No production or UIMS data is accessed. A green CI does not replace identity, hardware/Windows service testing, data retention, encryption, threat modeling, historical secret revocation, failover exercises or release approval. Production NO-GO.


## Hardened revision integration — 23 November 2026

The full-sync GitHub workflow now tests immutable audited peer versions, rather than older service versions. Synthetic tenant admin authentication is configured as explicit `NODE_ENV=test`, `TENANT_ADMIN_AUTH_MODE=legacy`, and `TENANT_ALLOW_DEV_API_KEY=true`; these options are **not allowed in production**. Central management login continues to default to OIDC, and Central event delivery uses a separate tenant-scoped agent key.

Additional negative end-to-end cases assert that a tenant A agent key cannot write an event claiming tenant B, a Central agent key cannot authorize Tenant Admin subject creation, and tenant header spoofing cannot switch a tenant-service instance to another tenant. After a refused Central event, PostgreSQL must contain no such event row.

**Verified new service-version CI:** https://github.com/myothein/tenant-agent/actions/runs/45094317774 — clean build, Windows native SQLite, PostgreSQL 17 / SQLite / Central PostgreSQL E2E, and scoped-identity negatives all passed on the tested commit. Repository hygiene: https://github.com/myothein/tenant-agent/actions/runs/45094317770 .

This tests a four-component integration path (including db-helper's exact versioned SQL schema) and does **not** mean the six GitHub components are jointly production-accepted. The management CLIs and Windows service operations have their own independent QA workflows; real Keycloak, cross-component release signing, on-host recovery, and UIMS compatibility remain unverified.

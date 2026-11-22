# Cross-repository full synchronization (CI-only)

This test exercises actual compiled code and real HTTP, PostgreSQL 17 and native SQLite:

1. tenant-service Subject API creates a subject with an atomic local_events outbox record.
2. tenant-agent polls via its scoped agent credential, preserving the source UUID in a durable SQLite outbox.
3. tenant-agent sends to central-service using a separate tenant-specific Central agent credential.
4. central-service persists the event in a separate ephemeral PostgreSQL database before returning acceptance.
5. The test simulates replay after central commit but before local sent marker, checks deduplication, simulates a missing central credential, verifies no event loss, retries, and checks persisted heartbeat server time.

Pinned code under test:
- tenant-service: f1359cabccbd79cf7a683879a11246b241bd21b1
- central-service: 26f068b862487cc9538d8a872381fac7ef82efe5
- db-helper migrations: bfae1246e28a43626e00627b9b812af579af4ab3

All databases, tokens, and subjects are CI-only synthetic fixtures. No production or UIMS data is accessed. A green CI does not replace identity, hardware/Windows service testing, data retention, encryption, threat modeling, historical secret revocation, failover exercises or release approval. Production NO-GO.

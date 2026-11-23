# Windows Tenant-Agent Runtime QA — 2026-11-22

**Release status: PRODUCTION NO-GO.** This procedure does not access UIMS V1 or production data and must not be conflated with Windows Service acceptance.

## Current evidence
- Local PC `DESKTOP-7GNNJBU` previously ran existing `agentctl` tests 18/18, tenant-agent API tests 12/12 and native SQLite tests 3/3 PASS in isolated `F:\GTSP-Infra-QA-20261122`.
- Evidence JSON was saved locally at `F:\GTSP-Infra-QA-20261122\QA_EVIDENCE_20261122.json`, with run logs and lockfile hashes. Local PC must be online to refresh this evidence.
- The GitHub three-service PostgreSQL→SQLite→PostgreSQL E2E is a separate CI verification.
- New `scripts/qa/windows-tenant-agent-process.cjs` provides a **nonprivileged process-level** integration scenario for Windows CI. It launches the compiled `node dist/index.js` process in a throwaway directory, uses synthetic local HTTP endpoints, asserts that failure leaves a SQLite event queued, verifies SQLite backup/restore, restarts the process, and checks idempotent replay. Invoke with `npm run test:windows-process` in a **disposable Windows CI environment**. **This script has not passed a recorded execution yet.**
- Windows process QA does **not** install NSSM, create/alter a Windows Service, access live PostgreSQL or read real credentials. It is distinct from `agentctl`'s previously passing synthetic Windows NSSM/SCM QA.

## Startup hardening
- No CLI arguments route directly to `startAgent()` without calling Commander help parsing.
- CLI commands still parse normally. Invalid or missing runtime configuration fails closed.
- `TENANT_SYNC_INTERVAL_MS` and `TENANT_HEARTBEAT_INTERVAL_MS` are bounded integer overrides (1,000–3,600,000 ms); production defaults remain 60s and 30s, respectively.

## Remaining release blockers
- The Windows process QA script must pass on a Windows runner. Modifying GitHub Actions to execute this script is currently blocked by a security check; do not report an unexecuted test as PASS.
- Real packaged service installation of **actual** tenant-agent under NSSM/SCM, service-account ACL review, protected secrets, resilient stop/restart behavior and outbox durability during power loss remain unverified.
- Independent restore of real staged data, audit trails, eventual event delivery, encryption/retention policy, exposed historical credential rotation, and owner approval still required.
- No merge of this Draft PR to main and no production deployment is authorized.

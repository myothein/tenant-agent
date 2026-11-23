# GTSP Six-Repository Public Exposure and Private CI Cutover

**Audit date:** 2026-11-23 (Myanmar)  
**Scope:** `myothein/central-service`, `tenant-service`, `db-helper`, `tenant-agent`, `agentctl`, and `central-cli`.  
**Classification:** security-sensitive metadata only; **no credential values, tokens, or database contents are reproduced in this document**.  
**Release:** PRODUCTION NO-GO. This report does **not** authorize repository visibility changes, live secret rotation, history rewriting, production deployment or merging of Draft PRs.

## Confirmed GitHub tracked-artifact exposure

All six repositories are **PUBLIC** as checked on 2026-11-23. The `main` commit tree of **every one** of these six repositories contains a tracked root `.env` file. In all six, the existing unmerged `hardening/release-security-baseline-20261122` Draft PR HEAD instead has **no tracked root `.env`** and has a sanitized `.env.example`. The release-gate workflow on the hardening branch rejects tracked environment files and runtime databases.

| PUBLIC `main` repository | Tracked files of concern | Nonempty sensitive-setting candidates, not a live-secret determination |
| --- | --- | --- |
| `central-service` | `.env` | database connection and JWT signing secret settings |
| `tenant-service` | `.env` | tenant database URL template setting |
| `db-helper` | `.env` | system and tenant database URL settings |
| `tenant-agent` | `.env`, `data/outbox.db`, `mybackup/outbox-backup-2025-12-30T06-28-09-539Z.db` | central API token setting; **two tracked SQLite data artifacts** |
| `agentctl` | `.env` | environment values present; whether they are live secrets has **not** been established |
| `central-cli` | `.env` | central API key setting |

**Interpretation:** A nonempty setting is not necessarily an active credential. No attempt was made to authenticate it, use it against a live database, or expose a file value. However, until independently assessed and revoked/rotated where appropriate, **treat all potentially live credentials as exposed**. SQLite databases may also contain sensitive historical tenant data; an authorized data owner must classify the payload and decide on incident notification/retention.

Removing a file in a Draft PR does **not** remove it from `main`, the repository's earlier Git objects, forks, external caches, releases, clones or previously downloaded artifacts. Marking a repository PRIVATE does not revoke already copied credentials or database data.

## Work already completed in sandbox

1. The existing six hardening Draft PR HEADs omit tracked `.env`, generated runtime data and database blobs and retain only sanitized `.env.example` files.
2. The `tenant-agent` full-sync workflow previously fetched three immutable `db-helper` SQL migrations from **public** `raw.githubusercontent.com` URLs. It now checks out `myothein/db-helper` at `cd99b4508ba4674110484527525ad9b172618b4a` using `actions/checkout@v4` with `persist-credentials:false`, compares `git rev-parse HEAD` with the exact expected commit, and copies the three audited migration files locally. This removes the **public raw URL dependency** but **not** the need for authorization once `db-helper` becomes private. The current job includes PostgreSQL 17 isolated migrations and no production database.
3. The pipeline still checks out `tenant-service`, `central-service`, `central-cli`, `db-helper` and `agentctl` from the six public repositories. No new cross-repository private token was issued or attached.

## Secure cutover sequence — requires owner and security approval

1. **Inventory and containment:** Classify each `.env` setting and both SQLite artifacts by system, owner, credential issuer, access scope and whether the referenced endpoint is reachable/live. Do not post secret values or DB rows to GitHub issues, PR comments or chats.
2. **Rotate/revoke with service owners:** Revoke exposed API keys and JWT signing secrets, rotate potentially active database users/URLs, verify dependent applications and revoke sessions/tokens as needed. Use official secret stores and audit logs. Coordinate centrally so production authentication does not break unexpectedly. Rotation/revocation is **not performed by this PR**.
3. **Private visibility approval:** Owner explicitly approves visibility changes for each of the six repositories after the impact of forks, collaborators and existing CI has been assessed. Do **not** rewrite history or delete repositories without a separately approved retention/legal/disaster-recovery plan.
4. **Authorized private read access:** Configure a trusted GitHub App installation or equivalent narrowly scoped read-only repo access for the five cross-repo checkouts. Generate short-lived installation tokens on a reviewed, trusted workflow reference. Do not embed personal access tokens, App private keys or installation tokens in repository YAML, files, command outputs or pull request logs.
5. **Protect PR event boundaries:** Ordinary `pull_request` checks, especially forks or contributor-modifiable workflow code, must **not** receive privileged cross-repository credentials. Consider a separate owner-triggered trusted-`workflow_dispatch` integration workflow with fixed audited refs and environments, requiring review before any secret-bearing job. Do not assume the default `GITHUB_TOKEN` has permission to read other private repositories.
6. **Prove exact private revision checkouts** in isolated Windows and PostgreSQL 17 Linux jobs, using unchanged immutable source SHAs. Confirm checkout failure is fail-closed and none of the CI logs expose secrets. Remove public raw downloads and unauthenticated external source fetches from every dependent workflow, not just this one.
7. **Re-review all six repositories:** Check hardening PRs, branch protection, private visibility, tracked-file scans, historical clone/cache exposure, signing/provenance, Keycloak integration and real off-host restore tests. Confirm production GO only through separately signed engineering/security approval.

## Explicit release blockers and current evidence

- **Public / historical tracked secrets and runtime data: OPEN.** Do not treat a green hygiene check on an unmerged branch as remediation of public `main`.
- **Private cross-repository checkout access: OPEN.** No read-only GitHub App token or trusted dispatch has been configured or verified.
- **Production keys rotation, source integrity, real Keycloak, off-host restore, six-component production-equivalent acceptance: OPEN.**
- **No changes** were made here to repository visibility, default branches, PR merge status, Git history, live secrets, remote Windows services, production databases or UIMS V1.

All facts in this report were based on current GitHub repository trees and Draft PR HEADs, with values redacted. If the branches change, repeat the inventory before production acceptance.

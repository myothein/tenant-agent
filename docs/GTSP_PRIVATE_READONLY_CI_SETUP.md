# GTSP V1 — Trusted Read-Only Private GitHub CI Preparation

**Date:** 2026-11-23  
**Release:** PRODUCTION NO-GO. This is a prepared, **inactive** manual workflow, not a connected GitHub App or verified private-repository integration.

## Implemented in the existing Draft PR

A separate workflow is present at `.github/workflows/private-readonly-ci.yml`. It **does not** use `pull_request`, `pull_request_target`, `workflow_run`, `push`, or `schedule` as triggers. GitHub must first have a reviewed workflow file on the repository's **default branch** before `workflow_dispatch` can run it; therefore this unmerged Draft PR does not activate the workflow. No merge or default-branch change has been made.

Its source-access job is allowed only when **all** these hold:

- The event is `workflow_dispatch`, on `refs/heads/main`, for exactly `myothein/tenant-agent`.
- The actor is exactly the `myothein` GitHub account.
- The manual input is `AUTHORIZE-READONLY-QA`.
- The job uses a separately provisioned **`gtsp-private-ci` protected environment**, intended to require an owner security-review approval and main-branch restriction.

The first job creates a **short-lived, automatically revoked** GitHub App installation token scoped to **Contents: read** and exactly these repositories: `central-service`, `tenant-service`, `db-helper`, `tenant-agent`, `agentctl`, `central-cli`. App Client ID and key are referred to only as the environment variable `GTSP_CI_APP_CLIENT_ID` and environment secret `GTSP_CI_APP_PRIVATE_KEY`. **No actual value has been set or transmitted by this PR.** Every code checkout is pinned to an audited 40-character commit and uses `persist-credentials: false`. All external GitHub Actions in this workflow are pinned by full commit SHA.

The privileged job performs only fixed revision/tree/file checks and packages an audited source snapshot **without Git data, runtime databases, `.env`, `node_modules` or build outputs**. It does not run repository-supplied `npm`, source scripts, build tools or tests. It uploads a restricted one-day artifact. The second job downloads that source snapshot and builds all six repositories under Node 22 **without** the App token, client secret, environment access or write-capable GitHub token.

The ordinary nonsecret pull-request CI also runs `node --test scripts/qa/private-ci-policy.test.cjs` to enforce the trigger/actor/reference, exact source pins, read-only scope, no persisted credentials and token-free second job. This is a **static security guard**, not actual GitHub App authentication or private checkout acceptance.

## Manual owner actions that are still required

1. Review and authorize the six-repo public `.env` exposure and tracked SQLite files, determine which historical credentials are live, and rotate/revoke them using the issuing services. Investigate possible historical data access. Do not post values in tickets or PRs.
2. Decide and authorize whether/when the six repositories should become private. Assess forks, collaborators, CI impact and access controls. **Do not** change Git history, delete public repositories or deploy in this workflow.
3. Independently register or approve a **GitHub App** installed only on the six repositories, with repository **Contents: read-only** (plus GitHub's required metadata access) and no write/administrative or actions-secrets permissions. Do not use a personal full-scope token.
4. After reviewing the Draft PR, prepare a protected `main` deployment path and a **`gtsp-private-ci` GitHub Actions environment** on `myothein/tenant-agent`. Configure required reviewer(s), restricted branch policy to `main`, and minimal environment access. Confirm the plan supports this environment protection before assuming its safeguards are active.
5. In that environment only, set `GTSP_CI_APP_CLIENT_ID` as an Actions environment variable and `GTSP_CI_APP_PRIVATE_KEY` as a masked Actions **environment secret**. Do not put key text in project files, source commits, chat messages or command-line logs. The ChatGPT Draft PR does not contain these values.
6. Only after explicit source-review/merge approval, trigger **GTSP private read-only six-repository QA** from the GitHub Actions UI, choosing **main** and typing `AUTHORIZE-READONLY-QA`. The actor must be `myothein`; unauthorized actor/branch/input should cause a skipped job. Require approval to reach the protected environment.
7. Inspect the checkout job for **all six exact pinned revisions**, absence of leaked credentials, proper token auto-revocation and the source artifact's contents/retention. Inspect the **separate token-free build job** for successful builds/tests and no unexpected network access to private repos.
8. After actual private checkout acceptance, update the existing unprivileged `pull_request` compatibility workflow with an owner-approved private-source strategy that does **not** expose read tokens to untrusted PR code. Continue staging Keycloak/OIDC, Windows per-service SID/OWNER RIGHTS, signed packaging and off-host backup/restore gates.

## Evidence and limitations

- The workflow source and its **static** CI policy are version-controlled only in the existing hardening Draft PR. The standalone private GitHub App workflow has not been dispatched, and has not run against private repositories.
- All six repositories were last verified **PUBLIC**. Their `main` trees contain historically tracked root `.env` files, and `tenant-agent/main` additionally tracks two runtime SQLite database/backup artifacts; see `docs/PUBLIC_EXPOSURE_PRIVATE_CI_CUTOVER.md`. Nothing here proves credentials were revoked or historic data copies erased.
- The new manual source build is **not** a production-equivalent six-program deployment or a substitute for real Keycloak, signed artifacts, service isolation or backup restore acceptance.
- Token access remains bound to the first GitHub-hosted job and automatic revocation is expected from the pinned official GitHub App token action; the second job has no environment secrets. Successful **static** security tests do not prove protections hold until GitHub environments, App installation and branch rules are separately configured and acceptance-tested.

**Do not execute production operations, merge Draft PRs, rotate credentials or change repository visibility without separate owner/security approval.**

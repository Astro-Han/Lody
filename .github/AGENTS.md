# GitHub contribution automation

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

- Keep contributor-facing prompts in `PULL_REQUEST_TEMPLATE.md`, policy logic in
  tested modules under `scripts/`, path ownership in `labeler.yml`, and GitHub
  event orchestration in `workflows/`. Do not duplicate the same rule across
  those layers.
- Changes to required PR template headings must update the checker in the same
  commit and validate representative complete and rejected bodies locally.
- `gh pr create --body` silently skips `PULL_REQUEST_TEMPLATE.md`. Draft the PR
  body from the template and validate it with
  `node .github/scripts/check-pr-body.mjs --body-file <file>`.
- Every fork-based PR references a Lody Issue and retains the complete Context
  handoff block and its markers. Use `Closes #123` when merging the PR should
  close the Issue and `Refs #123` only when it must stay open. A bare `#123` or
  full Lody Issue URL in `## Related issue` defaults to `Closes #123`. Each
  Authoring context field is a concise public summary; `N/A` and redacted values
  are not accepted because maintainers need enough provenance, scope, and risk
  information to assess the contribution.
- An Agent preparing a fork-based contribution does not treat creating an Issue
  as approval. It tells its author-side user about the policy and waits for
  explicit maintainer agreement on scope and approach before implementation or
  a PR. It also warns that Context handoff is public, invalid bodies close after
  seven days, and oversized PRs without an Issue reference get the same grace
  period. Never invent notice or agreement that did not happen. An Agent
  preparing a same-repository branch does not create or require an Issue solely
  for intake.
- Review instructions are a PR-specific handoff to the organization owners'
  reviewing Agent. Require concise review focus, decisions to challenge, and
  plausible failures or evidence gaps; fixed generic reviewer boilerplate and
  long review essays are not valid substitutes.
- `labeler.yml` is the source of truth for path-based `scope:*` labels. Overlap
  is intentional when a pull request affects multiple product areas.
- Issue forms cover only components present in the public repository. Keep Bug
  and Feature title prefixes, issue types, and existing labels aligned; route
  product support and security reports out of public issues, and request only
  diagnostics that contributors have checked and redacted.
- `scripts/check-issue-body.mjs` mirrors the required rendered headings and
  confirmations in both Issue Forms. Non-owner, non-bot issues that bypass or
  remove them receive the warning-only `status:needs-issue-body` state; regular
  organization members are not exempt. A valid edit clears the bot-owned state.
- External pull request enforcement compares GitHub's numeric `head.repo.id`
  and `base.repo.id`. Same-repository branches are internal regardless of author;
  fork branches are external regardless of `author_association`, and missing
  repository identity fails closed. Automated bot accounts remain exempt, and
  repository owners may explicitly exempt an exceptional fork PR with
  `status:pr-policy-bypass`; adding or removing it immediately reconciles both
  body and size policy state.
- `workflows/pr-policy.yml` is the only event entry point for external PR body,
  size, and expiry policy. The three implementation workflows remain callable
  only through `workflow_call`; route new events through the entry point so one
  run owns concurrency and dispatch.
- Workflows triggered by `pull_request_target` have a write-capable token. For
  PR events, read policy scripts and configuration from the trusted revision at
  `github.sha`; scheduled and manual audits use
  `github.event.repository.default_branch`. Never check out or execute the PR
  head, and never use the possibly stale `github.event.pull_request.base.sha`.
- Code CI runs on `pull_request` with read-only repository permissions, checks
  out all public submodules recursively, and keeps the stable `Static checks`
  and `Tests` jobs aligned with the root validation scripts so they can be used
  as required status checks.
- `scripts/pr-body-policy.mjs` owns PR-body status labels, comment markers, and
  the shared external-PR exemption, and the seven-day grace period. An invalid
  external PR keeps its original timer across edits and pushes; only a valid body
  or explicit exemption clears the state. Before closing, the scheduled workflow
  must re-read and revalidate the latest body.
- `scripts/pr-issue-link.mjs` is the sole parser and normalizer for
  `## Related issue`. On human PRs targeting the default branch, the trusted
  body workflow normalizes a bare issue number or full Lody Issue URL to
  `Closes #123`; explicit `Refs` and native closing keywords remain authoritative.
  The write is best-effort and must not block body enforcement. Never infer an
  Issue from a title, branch name, other body section, or diff.
- Fork-based PR size enforcement counts additions plus deletions. A change over
  200 lines without a Lody Issue reference is labeled `status:pr-too-large` and
  shares the PR-body seven-day correction window; adding a valid reference
  clears the warning, while body expiry performs the eventual closure.
  Automation does not infer maintainer agreement.
- PR-body comments require pull-request write permission. Immediate comment and
  label updates are best-effort feedback; the checker result alone decides the
  event-driven enforcement job. Expired PRs keep `status:pr-body-expired` and
  are closed again when reopened, so a contributor must submit a new PR.

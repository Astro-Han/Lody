import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BYPASS_PR_POLICY_LABEL,
  isExternalPullRequest,
  shouldEnforcePullRequest,
} from './pr-body-policy.mjs';
import { shouldWarnPullRequestSize } from './pr-size-policy.mjs';

const sameRepositoryPullRequest = {
  author_association: 'NONE',
  base: { repo: { id: 100, full_name: 'LodyAI/Lody' } },
  head: { repo: { id: 100, full_name: 'LodyAI/Lody' } },
  labels: [],
  additions: 201,
  deletions: 0,
  body: '',
  user: { login: 'contributor' },
};

const forkPullRequest = {
  ...sameRepositoryPullRequest,
  base: { repo: { id: 100, full_name: 'LodyAI/Lody' } },
  head: { repo: { id: 200, full_name: 'contributor/Lody' } },
};

void describe('external pull request policy', () => {
  void it('bypasses same-repository branches regardless of author association', () => {
    assert.equal(isExternalPullRequest(sameRepositoryPullRequest), false);
    assert.equal(shouldEnforcePullRequest(sameRepositoryPullRequest), false);
    assert.equal(shouldWarnPullRequestSize(sameRepositoryPullRequest), false);
  });

  void it('enforces fork branches regardless of author association', () => {
    for (const authorAssociation of ['OWNER', 'MEMBER', 'COLLABORATOR', 'NONE']) {
      const pullRequest = { ...forkPullRequest, author_association: authorAssociation };
      assert.equal(isExternalPullRequest(pullRequest), true);
      assert.equal(shouldEnforcePullRequest(pullRequest), true);
      assert.equal(shouldWarnPullRequestSize(pullRequest), true);
    }
  });

  void it('fails closed when either repository identity is missing', () => {
    assert.equal(isExternalPullRequest({ ...forkPullRequest, head: { repo: null } }), true);
    assert.equal(isExternalPullRequest({ ...forkPullRequest, base: { repo: null } }), true);
  });

  void it('does not trust matching repository names with different ids', () => {
    const pullRequest = {
      ...forkPullRequest,
      head: { repo: { id: 200, full_name: 'LodyAI/Lody' } },
    };
    assert.equal(isExternalPullRequest(pullRequest), true);
    assert.equal(shouldEnforcePullRequest(pullRequest), true);
  });

  void it('preserves bot and explicit-label exemptions for fork branches', () => {
    assert.equal(
      shouldEnforcePullRequest({ ...forkPullRequest, user: { login: 'renovate[bot]' } }),
      false
    );
    assert.equal(
      shouldEnforcePullRequest({
        ...forkPullRequest,
        labels: [{ name: BYPASS_PR_POLICY_LABEL.name }],
      }),
      false
    );
  });
});

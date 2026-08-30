import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasRelatedIssueLink,
  normalizeRelatedIssueLink,
  reconcilePullRequestIssueLink,
} from './pr-issue-link.mjs';

const body = (reference) => `## Related issue

${reference}

## Summary

Focused change.
`;

void describe('pull request issue links', () => {
  void it('defaults bare references and full Lody issue URLs to closing links', () => {
    assert.match(normalizeRelatedIssueLink(body('#121')), /\nCloses #121\n/);
    assert.match(
      normalizeRelatedIssueLink(body('https://github.com/LodyAI/Lody/issues/122')),
      /\nCloses #122\n/
    );
  });

  void it('preserves explicit closing and non-closing intent', () => {
    assert.equal(normalizeRelatedIssueLink(body('Fixes #121')), body('Fixes #121'));
    assert.equal(normalizeRelatedIssueLink(body('Refs #121')), body('Refs #121'));
    assert.match(
      normalizeRelatedIssueLink(body('Refs https://github.com/LodyAI/Lody/issues/121')),
      /\nRefs #121\n/
    );
  });

  void it('does not infer issue links from other sections or prose', () => {
    const prose = body('Discussed in https://github.com/LodyAI/Lody/issues/121');
    assert.equal(normalizeRelatedIssueLink(prose), prose);
    assert.equal(
      normalizeRelatedIssueLink('## Summary\n\nhttps://github.com/LodyAI/Lody/issues/121\n'),
      '## Summary\n\nhttps://github.com/LodyAI/Lody/issues/121\n'
    );
  });

  void it('recognizes every supported related-issue form', () => {
    for (const reference of [
      '#121',
      'LodyAI/Lody#121',
      'Closes #121',
      'Refs #121',
      'https://github.com/LodyAI/Lody/issues/121',
    ]) {
      assert.equal(hasRelatedIssueLink(body(reference)), true, reference);
    }
    assert.equal(hasRelatedIssueLink(body('Issue 121')), false);
  });

  void it('updates only human pull requests targeting the default branch', async () => {
    const updates = [];
    const github = {
      rest: {
        pulls: {
          update: async (input) => updates.push(input),
        },
      },
    };
    const pullRequest = {
      base: { ref: 'main' },
      body: body('#121'),
      number: 42,
      user: { login: 'contributor' },
    };

    assert.equal(
      await reconcilePullRequestIssueLink({
        github,
        owner: 'LodyAI',
        repo: 'Lody',
        pullRequest,
        defaultBranch: 'main',
      }),
      true
    );
    assert.deepEqual(updates, [
      {
        owner: 'LodyAI',
        repo: 'Lody',
        pull_number: 42,
        body: body('Closes #121'),
      },
    ]);

    for (const skippedPullRequest of [
      { ...pullRequest, base: { ref: 'release' } },
      { ...pullRequest, user: { login: 'renovate[bot]' } },
      { ...pullRequest, body: body('Closes #121') },
    ]) {
      assert.equal(
        await reconcilePullRequestIssueLink({
          github,
          owner: 'LodyAI',
          repo: 'Lody',
          pullRequest: skippedPullRequest,
          defaultBranch: 'main',
        }),
        false
      );
    }
    assert.equal(updates.length, 1);
  });
});

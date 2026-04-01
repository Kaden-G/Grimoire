# Branch Protection Setup

Configure these rules in GitHub → Settings → Branches → Add rule.

## `master` (production)

- **Branch name pattern:** `master`
- [x] Require a pull request before merging
  - [x] Require approvals: 1 (optional for solo dev, but good habit)
  - [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require status checks to pass before merging
  - Required checks: `Lint & Test`
- [x] Require branches to be up to date before merging
- [ ] Do not allow bypassing the above settings (toggle on when you have collaborators)

## `dev` (integration/testing)

- **Branch name pattern:** `dev`
- [x] Require a pull request before merging
- [x] Require status checks to pass before merging
  - Required checks: `Lint & Test`
- [ ] Require approvals (not needed for solo dev)

## Notes

- The "Lint & Test" check comes from `.github/workflows/ci.yml`
- You won't see the check name until CI has run at least once
- For solo development, you can skip the approval requirement on `dev`
  but keep it on `master` as a forcing function to review before publish

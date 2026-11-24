# moving next onto tangled.org (proposal, not started)

2026-11-23. a proposal awaiting nate's go/no-go. nothing below has been done
except the tag push noted under "mirror".

**the short version.** next can run fully on tangled, but the hard part isn't
CI: the Claude cloud threads that ship next are wired to GitHub (repo attach,
PRs, CI events) and can't reach tangled.org today (cloud proxy 403). the plan
proves that path first, runs CI in shadow on nate's own spindle, then flips.

## mirror: why it went stale

- the mirror is `tangled.org/zzstoatzz.io/plyr.fm` (ssh
  `git@tangled.sh:zzstoatzz.io/plyr.fm`). it only updated when someone ran
  `git push origin` from nate's mac checkout, whose `origin` has two push urls
  (GitHub + tangled). once threads merged through the GitHub API, nothing
  pushed to tangled, so it froze at `a72cddc0` (2026-11-12).
- nothing is lost: the two tangled-only commits (`a72cddc0`, `8e4f8dfa`) are on
  GitHub main as `cf1fd190` and `6ef6ad3e` with identical patch-ids.
- tags are pushed. one local tag,
  `archive/worktree-audit-2026-11-23/tangled.org-_wt-queue-gestures`, leaked up
  with them; delete it on tangled once nate says so.
- main is not pushed: histories diverged, so it needs
  `git push --force-with-lease=main:a72cddc0ecbac2fa26963da2f94836c1b5b3e538 tangled origin/main:refs/heads/main`.
  Claude's auto mode on the mac refuses a force push without nate's own typed
  OK naming it (or an `autoMode.allow` entry in `~/.claude/settings.json`).
  cherry-picking won't make tangled fast-forward.

## what next uses on GitHub today

15 Actions workflows, ~25 repo secrets, the PR + merge-on-green flow threads
use, the issue tracker (`ask-claude.yml` turns issues into Claude runs), and
the cloud harness itself. legacy prod deploys from GitHub releases and must
keep working until cutover. `next-catalog-diff` and `next-import-legacy-plays`
read prod's db and die at cutover, so they don't port.

## what tangled gives us

spindle covers triggers (push with paths, pull_request, manual, cron), secrets
(repo-wide only), OIDC, cache, PRs and webhooks. gaps: no artifacts (use R2),
no required checks or branch protection (merge-on-green becomes an agent
rule), no documented merge API (merge = push main after green), no issue
webhooks. nate's self-hosted `spindle.zzstoatzz.io` on heavypad (32c/62G, KVM,
4h microvm timeout, `MAX_JOB_COUNT=2`, config in `zzstoatzz.io/tangled-infra`)
can carry the long jobs; the hosted spindle caps at 15 min.

## plan

1. **resync and keep synced.** force-push (decision 1), then a systemd timer on
   heavypad pushes GitHub main to tangled every few minutes. gate: mirror main
   equals GitHub main minutes after a merge.
2. **prove a cloud thread can work on tangled.** allow `tangled.org`,
   `knot1.tangled.sh`, `api.tangled.org`, `spindle.zzstoatzz.io` in the cloud
   network settings; clone, push a branch, read a pipeline, push main. push is
   ssh and the proxy is https-only; the knot's `org.tangled.git.receivePack`
   scope may allow https push with a token, untested. gate: if a cloud thread
   can't do this with no mac in the loop, stop and keep GitHub primary.
3. **bot identity.** a bot collaborator with its own key / app password.
4. **port the 13 next workflows in shadow** (`.tangled/workflows/`, deploys
   behind `DRY_RUN=1`). gate: shadow results match GitHub's for a few days.
5. **re-mint secrets** on the spindle (new Fly/Cloudflare/Expo tokens, not
   copies).
6. **flip.** commits land on tangled; heavypad mirrors tangled → GitHub (keeps
   legacy release deploys alive); delete next's GitHub workflows in the same
   change; update AGENTS.md and skills. threads poll pipeline status on a
   timer.
7. **move issues** (script the open GitHub issues to tangled, each linking
   back); after cutover archive GitHub or keep it as a read-only mirror.

## decisions for nate

1. OK the mirror force-push (nothing is lost, see above).
2. go or no-go on the full move. if yes, step 2 runs first and decides the rest.
3. one repo or split next out. recommended: keep the monorepo.
4. who agents push as. recommended: a bot collaborator, not nate's keys.

## main risks

cloud threads can't push (step 2 tests it first); one home box runs all CI and
deploys (keep GitHub workflows revertable for weeks); CI queueing at ~250
merges/week vs 2 job slots; no required checks; repo-wide secrets readable by
any pusher; double deploys during the flip (same-change delete).

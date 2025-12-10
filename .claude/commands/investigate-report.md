---
description: Investigate the user report and fix it if you find it's a bug.
argumment-hint: [the user report]
---

First read the user report: $ARGUMENTS

Look around the codebase via `tree`, `rg` and perhaps related git history to find the root cause of the bug.

If you find the root cause, write a regression test, watch the test fail, fix the bug, and watch the test pass, then open a PR with the fix.
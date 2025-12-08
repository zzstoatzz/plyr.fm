# workflows

GitHub Actions workflows.

## debugging workflow runs

to get the Claude Code summary/report from a workflow run:

```bash
# get the summary URL for a specific run
# format: https://github.com/{owner}/{repo}/actions/runs/{run_id}/jobs/{job_id}/summary_raw

# step 1: get the job ID from the run
gh run view {run_id} --json jobs -q '.jobs[0].databaseId'

# step 2: construct the URL
# https://github.com/zzstoatzz/plyr.fm/actions/runs/{run_id}/jobs/{job_id}/summary_raw

# example for run 20017464306:
gh run view 20017464306 --json jobs -q '.jobs[0].databaseId'
# returns: 44812821179
# URL: https://github.com/zzstoatzz/plyr.fm/actions/runs/20017464306/jobs/44812821179/summary_raw
```

the summary contains Claude's full reasoning, tool calls, and outputs - much more useful than grepping through logs.

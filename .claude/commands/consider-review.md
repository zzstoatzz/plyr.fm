Check the current PR for comments, reviews, AND inline review comments via the gh cli.

For example, to get the review comments for PR #246:

```bash
gh api repos/zzstoatzz/plyr.fm/pulls/246/comments --jq '.[] | {path: .path, line: .line, body: .body}'
```
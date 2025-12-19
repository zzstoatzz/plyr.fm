---
description: Research a topic thoroughly and persist findings
argument-hint: [topic or question to research]
---

# research

deep dive on a topic, persist findings to `docs/research/`.

## process

1. **understand the question**: $ARGUMENTS

2. **gather context** - spawn sub-tasks in parallel to:
   - grep for relevant keywords
   - find related files and directories
   - read key implementation files
   - check git history if relevant

3. **synthesize findings** - after sub-tasks complete:
   - summarize what you learned
   - include file:line references for key discoveries
   - note any open questions or uncertainties

4. **persist to docs/research/** - write findings to `docs/research/YYYY-MM-DD-topic.md`:

```markdown
# research: [topic]

**date**: YYYY-MM-DD
**question**: [the original question]

## summary

[2-3 sentences on what you found]

## findings

### [area 1]
- finding with reference (`file.py:123`)
- another finding

### [area 2]
...

## code references

- `path/to/file.py:45` - description
- `another/file.ts:12-30` - description

## open questions

- [anything unresolved]
```

5. **present summary** to the user with key takeaways

## guidelines

- spawn sub-tasks for broad searches, read files yourself for focused analysis
- always include file:line references - make findings actionable
- be honest about what you don't know
- keep the output concise - this is a working document, not a thesis

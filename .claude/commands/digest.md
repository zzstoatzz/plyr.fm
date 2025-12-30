---
description: Extract actionable insights from an external resource
argument-hint: [URL, AT-URI, or description of resource]
---

# digest

break down an external resource and identify what it means for us.

## process

1. **fetch the resource**: $ARGUMENTS
   - use pdsx MCP for AT-URIs (bsky posts, leaflet docs, etc.)
   - use WebFetch for URLs
   - ask for clarification if the resource type is unclear

2. **extract concrete information**:
   - what are they doing?
   - what's their architecture/approach?
   - what are their constraints and priorities?
   - what's their roadmap?

3. **cross-reference with our state**:
   - check open issues for overlap or gaps
   - grep codebase for related implementations
   - identify where we align or diverge

4. **identify actionable implications** - the core output:
   - "given that X is true, we should consider Y"
   - specific issues to open or update
   - code changes to consider
   - integration opportunities
   - things we're missing or doing wrong

5. **present findings** - be direct:
   - lead with the implications, not the summary
   - include specific file:line or issue references
   - propose concrete next steps

## anti-patterns

- philosophical musing without action items
- "we're complementary" without specifics
- agreeing that everything is fine
- backpedaling when challenged

## output format

```
## implications

1. **[actionable item]**: [reasoning]
   - related: `file.py:123` or issue #456
   - suggested: [specific change or issue to create]

2. **[actionable item]**: ...

## extracted facts

- [concrete thing from the resource]
- [another concrete thing]

## open questions

- [things to clarify or investigate further]
```

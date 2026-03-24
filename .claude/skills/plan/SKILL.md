---
description: Create an implementation plan before coding
argument-hint: [issue number, description, or path to research doc]
---

# plan

think before coding. create an implementation plan and get alignment.

## process

1. **understand the task**: $ARGUMENTS
   - if issue number given, fetch it with `gh issue view`
   - if research doc referenced, read it fully
   - read any related code

2. **research if needed** - if you don't understand the problem space:
   - spawn sub-tasks to explore the codebase
   - find similar patterns we can follow
   - identify integration points and constraints

3. **propose approach** - present to user:
   ```
   based on [context], I understand we need to [goal].

   current state:
   - [what exists now]

   proposed approach:
   - [high-level strategy]

   questions:
   - [anything unclear]
   ```

4. **resolve all questions** - don't proceed with open questions

5. **write the plan** to `docs/plans/YYYY-MM-DD-description.md`:

```markdown
# plan: [feature/task name]

**date**: YYYY-MM-DD
**issue**: #NNN (if applicable)

## goal

[what we're trying to accomplish]

## current state

[what exists now, constraints discovered]

## not doing

[explicitly out of scope]

## phases

### phase 1: [name]

**changes**:
- `path/to/file.py` - [what to change]
- `another/file.ts` - [what to change]

**success criteria**:
- [ ] tests pass: `just backend test`
- [ ] [specific behavior to verify]

### phase 2: [name]
...

## testing

- [key scenarios to test]
- [edge cases]
```

6. **ask for confirmation** before finalizing

## guidelines

- no open questions in the final plan - resolve everything first
- keep phases small and testable
- include specific file paths
- success criteria should be verifiable
- if the task is small, skip the formal plan and just do it

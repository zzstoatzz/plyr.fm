---
description: Execute an implementation plan phase by phase
argument-hint: [path to plan in docs/plans/]
---

# implement

execute a plan systematically, phase by phase.

## process

1. **read the plan**: $ARGUMENTS
   - read it fully
   - check for existing checkmarks (prior progress)
   - read all files mentioned in the plan

2. **pick up from first unchecked item**
   - if resuming, trust that completed work is done
   - start with the next pending phase

3. **implement each phase**:
   - make the changes described
   - run the success criteria checks
   - fix any issues before proceeding
   - check off completed items in the plan file

4. **pause for verification** after each phase:
   ```
   phase N complete.

   automated checks passed:
   - [list what passed]

   ready for manual verification:
   - [list manual checks from plan]

   continue to phase N+1?
   ```

5. **continue or stop** based on user feedback

## guidelines

- follow the plan's intent, adapt to what you find
- if something doesn't match the plan, stop and explain:
  ```
  issue in phase N:
  expected: [what plan says]
  found: [actual situation]
  how should I proceed?
  ```
- run `just backend test` and `just backend lint` frequently
- commit after each phase if changes are substantial
- update the plan file checkboxes as you complete items

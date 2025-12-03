# status update

update STATUS.md after completing significant work.

## when to update

after shipping something notable:
- new features or endpoints
- bug fixes worth documenting
- architectural changes
- deployment/infrastructure changes
- incidents and their resolutions

## how to update

1. add a new subsection under `## recent work` with today's date
2. describe what shipped, why it matters, and any relevant PR numbers
3. update `## immediate priorities` if priorities changed
4. update `## technical state` if architecture changed

## structure

STATUS.md follows this structure:
- **long-term vision** - why the project exists
- **recent work** - chronological log of what shipped (newest first)
- **immediate priorities** - what's next
- **technical state** - architecture, what's working, known issues

old content is automatically archived to `.status_history/` - you don't need to manage this.

## tone

direct, technical, honest about limitations. useful for someone with no prior context.

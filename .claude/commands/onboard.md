# Onboard

Read the current project status and propose the next best step to continue development.

## Purpose

This command helps a new agent/contributor quickly understand where the project is and what to work on next. Use this when starting a new session or when context has been cleared.

## Instructions

1. **Read STATUS.md** at the root of the repository
   - Understand the long-term, medium-term, and short-term vision
   - Review the current technical state
   - Note what's working, what's in progress, and known issues (via gh cli)

2. **Review Key Files**
   - `README.md` - project overview and quick start
   - `CLAUDE.md` - critical reminders and technical details
   - Recent commits (`git log --oneline -10`)
   - Current git status (`git status`)

3. **Assess Codebase State**
   - Check active branches and recent work
   - Review any TODO comments or incomplete features
   - Look at test coverage and known failures

4. **Propose Next Best Step**

   Prioritize based on:
   - **Short-term vision items** from STATUS.md (highest priority)
   - **Known issues** that are blocking or high-impact
   - **In-progress work** that needs completion
   - **Missing critical features** for core functionality
   - **Technical debt** that impedes progress

   Present:
   - **Recommended next step** with clear rationale
   - **Why this step** (how it advances the vision)
   - **What needs to be done** (specific tasks)
   - **Potential challenges** or considerations
   - **Alternative options** if there are multiple viable paths

5. **Ask for Confirmation**
   - Present the proposal clearly
   - Ask if the user wants to proceed with this step
   - Offer to explore alternatives if needed


## Tone

- Action-oriented and specific
- Helpful for someone getting their bearings
- Respectful of existing decisions and trade-offs


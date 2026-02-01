# PizzaDAO Onboarding App

## Project Overview
Next.js application for PizzaDAO member onboarding, profile management, and community features.

## Tech Stack
- **Framework**: Next.js (App Router)
- **Database**: Supabase (PostgreSQL)
- **Auth**: Discord OAuth
- **Styling**: Tailwind CSS
- **Task Tracking**: Google Sheets via `sheets-claude` MCP
- **Deployment**: Vercel

## Task Management Workflow

### Project Sheet
Tasks are tracked in the project Google Sheet, accessible via the sheets-claude MCP.
- Config: `.sheets-claude.json` contains the sheet URL
- Sheet: [PizzaDAO Dashboard](https://docs.google.com/spreadsheets/d/1bRTR85CDHbTAsTG6sVi1jv6H-WjLyf-yvOerLCqeY2Q/edit?gid=0#gid=0)
- Use `mcp__sheets-claude__get_project_tasks` to list tasks

### Complete Workflow

```
1. GET TASKS      →  Fetch from project sheet
2. PLAN           →  Spawn planning agents (background, parallel)
3. SAVE PLANS     →  Plans saved to plans/{task-id}-{slug}.md
4. REVIEW PLANS   →  Snax and Claude review together
5. IMPLEMENT      →  Spawn implementation agents on feature branches
6. REVIEW CODE    →  Snax and Claude review changes via Vercel preview
7. MERGE          →  Merge approved PRs to main
8. MARK DONE      →  Update project sheet
```

### Phase 1: Planning

**Do NOT enter plan mode directly** - spawn background planning agents instead.

```
Task tool:
- subagent_type: "Plan"
- run_in_background: true
- prompt: Include task ID, read codebase, write plan to plans/{task-id}-{slug}.md
```

**Batch planning**: Queue multiple planning agents in parallel for efficiency.

**Plan file format** (`plans/{task-id}-{slug}.md`):
- Task ID and priority
- Problem/feature description
- Root cause (for bugs)
- Database changes needed
- Files to create/modify
- Step-by-step implementation
- Verification steps

### Phase 2: Review Plans

- Claude summarizes each plan for Snax
- Discuss approach, ask clarifying questions
- Approve or adjust plans before implementation

### Presenting Tasks to Snax

**Always include task IDs** when listing or discussing tasks:

```
| Task ID | Task | Priority |
|---------|------|----------|
| example-12345 | Fix login bug | High |
```

This makes it easy for Snax to refer to specific tasks in conversation.

### Phase 3: Implementation

**Each task gets its own git worktree** for isolated parallel work, with **draft PRs** for Vercel previews.

#### Worktree Setup
```bash
# Agent creates isolated worktree with feature branch
git worktree add ../onboarding-{task-id} -b feature/{task-id}-{name}
cd ../onboarding-{task-id}
```

#### Agent Instructions
```
Task tool:
- subagent_type: "general-purpose"
- run_in_background: true
- prompt:
  1. Create worktree: git worktree add ../onboarding-{task-id} -b feature/{task-id}-{name}
  2. cd into the worktree directory
  3. Read plan from plans/{task-id}.md (copy from main repo if needed)
  4. Implement the approved changes
  5. Commit with descriptive message including task ID
  6. Push branch: git push -u origin feature/{task-id}-{name}
  7. Create draft PR: gh pr create --draft --title "Task ID: Description" --body "..."
  8. Report:
     - PR URL
     - Vercel preview URL: https://onboarding-git-feature-{task-id}-{name}-pizza-dao.vercel.app
     - Files changed
```

#### Vercel Preview URLs
PRs automatically get Vercel preview deployments:
```
https://onboarding-git-{branch-name}-pizza-dao.vercel.app
```

Example: `feature/pizza-12345-fix-login` →
`https://onboarding-git-feature-pizza-12345-fix-login-pizza-dao.vercel.app`

#### After Review
```bash
# Merge the PR via GitHub (or locally)
gh pr merge {pr-number} --merge

# Clean up worktree
git worktree remove ../onboarding-{task-id}
```

**Parallel implementation**: Multiple agents work in separate worktrees simultaneously - no conflicts.

**Small tasks** (< 10 lines, single file): Can be done directly by Claude in main repo after plan review.

### Branching Convention

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code |
| `feature/{task-id}-{name}` | Individual task implementation |

## Google Sheets Tables Feature - Known Issue

**Problem**: The sheet uses Google Sheets "Tables" feature (the filter dropdowns on headers). This causes the GViz API to return malformed data with concatenated column labels.

**Solution**: The `sheets-claude` MCP server has a fallback parser that handles this. If header detection fails after modifying the sheet structure, check:
- The header row is immediately below the "Tasks" table anchor
- Column headers match expected patterns: `task`, `stage`, `priority`, `due`, `lead id`, `lead`, `notes`, `tags`

## Development

```bash
npm run dev     # Start development server
npm run build   # Production build
npm run lint    # Run linter
```

## Key Directories
- `/app` - Next.js App Router pages and API routes
- `/components` - React components
- `/lib` - Utility functions and shared code
- `/prisma` - Database schema
- `/public` - Static assets
- `/plans` - Task implementation plans

## Environment Variables
Required env vars are in `.env.local` (not committed). See Vercel project settings for production values.

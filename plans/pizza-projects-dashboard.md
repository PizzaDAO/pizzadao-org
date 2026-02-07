# Pizza Projects Dashboard

## Overview
A comprehensive dashboard showing all PizzaDAO projects, integrated into the main PizzaDAO website. Public access, full feature set.

**Repo**: `PizzaDAO/onboarding`
**Route**: `/tech/projects`
**URL**: `pizzadao.org/tech/projects`

---

## Features

### 1. Project List & Cards
Each project displayed as a card with:
- **Name** and **description** (from GitHub)
- **Status badge**: Active | Maintenance | Archived | Planning
- **Tech stack tags**: Auto-detected from repo files
- **Activity indicator**: Last commit date, activity sparkline
- **Links**: GitHub repo, live site, Vercel preview

### 2. Task Integration (sheets-claude)
For projects with task sheets:
- Task counts by stage (To Do / Doing / Done / Stuck)
- Top 3 priority tasks shown inline
- "View all tasks" expands full task list
- Blocked tasks highlighted in red

**Sheet Discovery**:
1. Check for `.sheets-claude.json` in repo
2. If not found, check for Google Sheets icon link in the deployed site
3. Create `.sheets-claude.json` for projects that have the icon but no config

### 3. Activity & Health Metrics
- Open PRs count (with links)
- Open Issues count (with links)
- Last commit date and author
- Commit frequency sparkline (30 days)
- Build/deploy status badge (if available)

### 4. Search & Filter
- **Search**: Project name, description, README content
- **Filter by status**: Active, Maintenance, Archived, Planning
- **Filter by tech**: TypeScript, Solidity, Python, etc.
- **Filter by activity**: Recently active, Stale (>30 days), Dormant (>90 days)
- **Sort by**: Name, Last updated, Task count, Activity

### 5. Quick Actions
- Copy clone command
- Open in GitHub
- Create new issue
- View open PRs
- Link to project sheet (if exists)

### 6. Project Detail View
Clicking a project card opens expanded view with:
- Full README rendered
- Complete task list from sheets-claude
- Recent commits list
- Contributors with avatars
- Dependency graph (if applicable)

---

## Technical Architecture

### Data Sources
1. **GitHub API** (via `mcp__github__` or `gh` CLI)
   - Repository list for PizzaDAO org
   - README content
   - Open PRs/Issues
   - Commit history
   - Contributors

2. **sheets-claude MCP**
   - Project tasks per sheet
   - Task counts and status

3. **Static config** (for metadata GitHub doesn't have)
   - Project status overrides
   - Live URLs
   - Custom descriptions

### Data Flow
```
GitHub API ──┐
             ├──> Server-side fetch ──> Cache (15 min) ──> Dashboard UI
sheets-claude──┘
```

### Caching Strategy
- GitHub data: Cache 15 minutes (avoid rate limits)
- Task data: Cache 15 minutes
- Manual refresh button available

### File Structure (in onboarding repo)
```
app/
├── tech/
│   └── projects/
│       ├── page.tsx              # Main dashboard
│       ├── [slug]/
│       │   └── page.tsx          # Project detail view
│       └── loading.tsx           # Loading skeleton
components/
└── projects/
    ├── ProjectCard.tsx       # Individual project card
    ├── ProjectGrid.tsx       # Grid layout
    ├── TaskSummary.tsx       # Task counts component
    ├── ActivitySparkline.tsx # Commit activity chart
    ├── FilterBar.tsx         # Search and filters
    └── QuickActions.tsx      # Action buttons
app/lib/
└── projects/
    ├── github.ts             # GitHub API calls
    ├── tasks.ts              # sheets-claude integration
    ├── cache.ts              # Caching logic
    └── types.ts              # TypeScript types
data/
└── projects-config.json      # Static overrides
```

---

## Data Model

### Project
```typescript
interface Project {
  // From GitHub
  name: string;
  slug: string;
  description: string | null;
  githubUrl: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;

  // Computed/detected
  techStack: string[];
  activityLevel: 'active' | 'stale' | 'dormant';

  // From config overrides
  status: 'active' | 'maintenance' | 'archived' | 'planning';
  liveUrl?: string;
  vercelProject?: string;
  sheetUrl?: string;

  // From GitHub API
  openPRs: number;
  openIssues: number;
  contributors: Contributor[];
  recentCommits: Commit[];

  // From sheets-claude
  tasks?: {
    todo: number;
    doing: number;
    done: number;
    stuck: number;
    topPriority: Task[];
  };
}
```

---

## UI/UX Design

### Dashboard Layout
```
┌─────────────────────────────────────────────────────────────┐
│  PizzaDAO Projects                               [Refresh]  │
├─────────────────────────────────────────────────────────────┤
│  [Search...                    ] [Status ▼] [Tech ▼] [Sort ▼]│
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ rsv-pizza    │  │ onboarding   │  │ kickme-wtf   │       │
│  │ Active       │  │ Active       │  │ Active       │       │
│  │              │  │              │  │              │       │
│  │ Party plan.. │  │ New member.. │  │ Soulbound..  │       │
│  │              │  │              │  │              │       │
│  │ TS React     │  │ TS Next.js   │  │ TS Solidity  │       │
│  │ ━━━━━░░░░░   │  │ ━━━━━━━░░░   │  │ ━━░░░░░░░░   │       │
│  │              │  │              │  │              │       │
│  │ Tasks: 3/2/5 │  │ Tasks: 5/1/8 │  │ No sheet     │       │
│  │ PRs: 2       │  │ PRs: 0       │  │ PRs: 1       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ... more projects ...                                       │
└─────────────────────────────────────────────────────────────┘
```

### Status Colors
- Active - Green
- Maintenance - Yellow
- Archived - Red
- Planning - Blue

---

## Implementation Phases

### Phase 1: Core Structure + Tests
- [ ] Set up test infrastructure (Playwright + unit tests)
- [ ] Create `/tech/projects` route in onboarding
- [ ] GitHub API integration (list repos)
- [ ] Basic ProjectCard component
- [ ] ProjectGrid with responsive layout

### Phase 2: Data Enrichment
- [ ] Fetch README content
- [ ] Detect tech stack from repo files
- [ ] Calculate activity level
- [ ] Cache layer implementation

### Phase 3: Task Integration
- [ ] sheets-claude integration
- [ ] TaskSummary component
- [ ] Discover sheets from `.sheets-claude.json` or site icons
- [ ] Create missing `.sheets-claude.json` files for projects with sheet links

### Phase 4: Activity Metrics
- [ ] Fetch open PRs/Issues
- [ ] Recent commits
- [ ] ActivitySparkline component
- [ ] Contributors list

### Phase 5: Search & Filter
- [ ] FilterBar component
- [ ] Search implementation
- [ ] Multi-select filters
- [ ] Sort options

### Phase 6: Quick Actions & Detail View
- [ ] QuickActions component
- [ ] Project detail page (`/tech/projects/[slug]`)
- [ ] Full README render
- [ ] Complete task list view

### Phase 7: Polish
- [ ] Loading skeletons
- [ ] Error states
- [ ] Empty states
- [ ] Mobile responsive
- [ ] Keyboard navigation

---

## Configuration File

`data/projects-config.json`:
```json
{
  "projects": {
    "rsv-pizza": {
      "status": "active",
      "liveUrl": "https://rsv.pizza",
      "sheetUrl": "https://docs.google.com/spreadsheets/d/..."
    },
    "onboarding": {
      "status": "active",
      "liveUrl": "https://pizzadao.org",
      "sheetUrl": "https://docs.google.com/spreadsheets/d/1bRTR85CDHbTAsTG6sVi1jv6H-WjLyf-yvOerLCqeY2Q"
    },
    "pizza-smartcontract": {
      "status": "maintenance"
    },
    "hugo-website": {
      "status": "archived"
    }
  },
  "excludeRepos": [
    "pizza-github-actions-test"
  ]
}
```

---

## API Endpoints

Server-side API routes to avoid rate limits and centralize caching:

- `GET /api/tech/projects` - List all projects with cached data
- `GET /api/tech/projects/[slug]` - Single project detail
- `GET /api/tech/projects/[slug]/tasks` - Tasks for a project
- `POST /api/tech/projects/refresh` - Force cache refresh

---

## Dependencies

### New packages needed:
- `recharts` - For activity sparkline charts
- Existing: Next.js, Tailwind (already in onboarding)

### External APIs:
- GitHub REST API (via Octokit or fetch)
- Google Sheets (for task data)

---

## Decisions Made

1. **Sheet mapping**: Discover via `.sheets-claude.json` first, then fall back to Google Sheets icon link in deployed site. Create `.sheets-claude.json` for projects missing it.

2. **Private repos**: Public repos only.

3. **Refresh frequency**: Manual refresh button + 15 minute cache.

4. **TDD Approach**: Write tests first for each component and feature.

---

## Success Metrics

- All PizzaDAO public repos visible
- Task data showing for projects with sheets
- < 3 second initial load
- Mobile-friendly
- Zero GitHub rate limit errors
- Full test coverage

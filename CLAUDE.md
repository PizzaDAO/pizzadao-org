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

## Project Sheet
- Sheet: [PizzaDAO Dashboard](https://docs.google.com/spreadsheets/d/1bRTR85CDHbTAsTG6sVi1jv6H-WjLyf-yvOerLCqeY2Q/edit?gid=0#gid=0)

## Key Directories
- `/app` - Next.js App Router pages and API routes
- `/components` - React components
- `/lib` - Utility functions and shared code
- `/prisma` - Database schema
- `/public` - Static assets
- `/plans` - Task implementation plans

## Development
```bash
npm run dev     # Start development server
npm run build   # Production build
npm run lint    # Run linter
```

## Environment Variables
Required env vars are in `.env.local` (not committed). See Vercel project settings for production values.

## Project-Specific Notes

### Google Sheets Tables Feature
The sheet uses Google Sheets "Tables" feature (filter dropdowns on headers). This causes the GViz API to return malformed data with concatenated column labels.

**Solution**: The `sheets-claude` MCP server has a fallback parser that handles this. If header detection fails after modifying the sheet structure, check:
- The header row is immediately below the "Tasks" table anchor
- Column headers match expected patterns: `task`, `stage`, `priority`, `due`, `lead id`, `lead`, `notes`, `tags`

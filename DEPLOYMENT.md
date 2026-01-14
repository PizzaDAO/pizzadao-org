# Deployment Guide

## Quick Reference

| Environment | Branch | URL | Status |
|---|---|---|---|
| **Production** | `main` | https://onboarding-black-tau.vercel.app | ✅ Live |
| **Staging** | `staging` | Auto-deployed to Vercel | 🔄 Preview |

## For Developers

### Want to test your changes?

1. **Create a feature branch from `staging`** (not `main`):
   ```bash
   git checkout staging
   git pull origin staging
   git checkout -b feature/my-feature
   ```

2. **Make your changes and push:**
   ```bash
   git add .
   git commit -m "Add my feature"
   git push origin feature/my-feature
   ```

3. **Create a PR to `staging` on GitHub**
   - Vercel will automatically deploy a preview
   - Test your changes in the staging environment
   - Request review from team members

4. **After approval and merge to `staging`:**
   - Changes are deployed to staging preview URL
   - Continue testing in realistic environment
   - Create PR from `staging` → `main` when ready

5. **Merge to `main` for production:**
   - After final review and approval
   - Vercel automatically deploys to production
   - Monitor https://onboarding-black-tau.vercel.app

### Quick Commands

```bash
# Start a new feature from staging
git checkout staging && git pull && git checkout -b feature/my-feature

# Push and create PR
git push origin feature/my-feature

# After merge to staging, verify it works
# Then merge staging → main for production
```

## For DevOps / Maintainers

### Setting Up a New Environment

This project uses **Vercel with automatic branch deployments**:

1. **Production** (`main` branch)
   - Auto-deploys on every push to `main`
   - URL: https://onboarding-black-tau.vercel.app
   - Environment: Production database + services

2. **Staging** (`staging` branch)
   - Auto-deploys on every push to `staging`
   - URL: Auto-generated preview (check Vercel dashboard)
   - Environment: Shared staging database

### Environment Variables

**Critical variables stored in Vercel (never in Git):**
- `DATABASE_URL` - Primary database connection
- `DISCORD_BOT_TOKEN` - Discord bot credentials
- `DISCORD_CLIENT_SECRET` - OAuth credentials
- `GOOGLE_SERVICE_ACCOUNT_JSON` - Google Sheets access
- `SESSION_SECRET` - Cookie signing key
- `OPENAI_API_KEY` - OpenAI API key
- `TMDB_API_KEY` - Movie database API

**To add/modify environment variables:**
1. Go to Vercel Dashboard: https://vercel.com/pizzadao/onboarding
2. Settings → Environment Variables
3. Add variable with appropriate scope
4. Vercel auto-redeployed affected deployments

### Monitoring Deployments

**Vercel Dashboard:** https://vercel.com/pizzadao/onboarding

**Check deployment status:**
1. Deployments tab shows all recent builds
2. Click a deployment for detailed logs
3. Logs show build errors, warnings, and timing

**Useful links:**
- View all deployments: Deployments tab
- Check performance: Analytics tab
- View error tracking: Error tracking tab
- Manage team members: Team settings

### Rollback Process

**If production is broken:**

1. **Quick rollback via Vercel:**
   - Go to Vercel Dashboard → Deployments
   - Find the last working deployment
   - Click "Redeploy"

2. **Permanent fix:**
   ```bash
   git checkout main
   git revert <commit-hash>
   git push origin main
   # Vercel auto-deploys the fix
   ```

3. **Notify team:**
   - Post in appropriate channel
   - Document what went wrong
   - Update team on status

### Database Management

**Production Database:** Neon PostgreSQL (pooled connection)

**Connection strings stored in Vercel:**
- `DATABASE_URL` - Use this for production
- `DATABASE_URL_UNPOOLED` - Use for Prisma migrations if pooled fails

**Running migrations:**
```bash
# Local development
npm run db:migrate

# Vercel (via deployment hooks)
Migrations run automatically before build
```

## Branch Management

### Main Branch (`main`)
- ✅ Always deployable to production
- ✅ All code reviewed and tested in staging
- ❌ Do NOT push directly to main
- ❌ Do NOT commit environment variables

### Staging Branch (`staging`)
- ✅ Safe to test new features
- ✅ Same database as production
- ✅ Auto-deployed to preview URL
- ⚠️ Test before merging to main

### Feature Branches
- Named: `feature/*`, `fix/*`, `hotfix/*`, `chore/*`
- Origin: Always from `staging` (except hotfixes from `main`)
- Target: `staging` first, then `main`
- Lifetime: Deleted after merge

## Building & Testing Locally

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env.local

# Run dev server
npm run dev

# Build for production
npm run build

# View build output
npm run start
```

## Performance Metrics

**Build Time:** ~2 minutes
**Pages Generated:** 53
**TypeScript Check:** Passes ✅

**Recent Commits:**
- Phase 3C: Profile route refactoring (86d74ba)
- Phase 3B: Error handling standardization (4cd789a)

## Troubleshooting

### Build Failed

1. Check Vercel logs:
   ```
   Vercel Dashboard → Deployments → [Failed build] → Logs
   ```

2. Common issues:
   - **TypeScript error:** Fix and push again
   - **Missing env vars:** Add to Vercel dashboard
   - **DB connection:** Check `DATABASE_URL` in Vercel

### Staging URL Not Updating

1. Verify push succeeded: `git log origin/staging`
2. Check Vercel deployment status (< 5 min usually)
3. Hard refresh browser: `Ctrl+Shift+R`
4. Check Vercel logs if still failing

### Production Issue

1. **Check logs:** Vercel Dashboard → Logs
2. **Identify commit:** `git log --oneline origin/main | head -5`
3. **Rollback if urgent:** Redeploy previous version from Vercel
4. **Fix properly:** Create PR with fix, merge after review

## Related Documentation

- **[STAGING.md](./STAGING.md)** - Detailed staging workflow and best practices
- **[Contributing]** - Development guidelines (if exists)
- **[Architecture](./context.md)** - System architecture overview

---

**Last Updated:** January 14, 2024
**Contact:** Development team

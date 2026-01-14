# Staging Environment Setup & Workflow

## Overview

This project uses a branch-based deployment strategy with two main environments:

- **Production** (`main` branch) → https://onboarding-black-tau.vercel.app
- **Staging** (`staging` branch) → Auto-deployed preview URL (TBD after first deployment)

## Deployment Strategy

### Production (`main`)
- **Branch:** `main`
- **Auto-deploy:** Yes, on every push
- **URL:** https://onboarding-black-tau.vercel.app
- **Environment:** Production database and services
- **Process:**
  1. All features developed on feature branches
  2. Create PR to `main` for code review
  3. Merge to `main` after approval
  4. Vercel automatically deploys to production

### Staging (`staging`)
- **Branch:** `staging`
- **Auto-deploy:** Yes, on every push
- **URL:** Auto-generated preview URL (check Vercel dashboard)
- **Environment:** Shared staging database (same as production)
- **Process:**
  1. Create feature branches from `staging` (not `main`)
  2. Create PR to `staging` for testing
  3. Merge to `staging` to test in realistic environment
  4. Vercel automatically deploys to staging preview
  5. After validation, create PR from `staging` → `main`

## Workflow: Adding a Feature

### Option A: Feature Branch → Staging → Main (Recommended)

```bash
# 1. Start from staging branch
git checkout staging
git pull origin staging

# 2. Create feature branch from staging
git checkout -b feature/my-feature

# 3. Make changes and commit
git add .
git commit -m "Add my feature"

# 4. Push to GitHub
git push origin feature/my-feature

# 5. Create PR: feature/my-feature → staging
#    - Test in staging environment
#    - Run manual tests if needed

# 6. After staging validation, create PR: staging → main
#    - This deploys to production after approval
```

### Option B: Feature Branch → Main (Simple hotfixes)

For urgent hotfixes:

```bash
# 1. Start from main
git checkout main
git pull origin main

# 2. Create feature branch from main
git checkout -b hotfix/urgent-fix

# 3. Make changes and commit
git add .
git commit -m "Fix urgent issue"

# 4. Push to GitHub and create PR directly to main
git push origin hotfix/urgent-fix
```

## Environment Configuration

### Vercel Dashboard Settings

1. **Production Environment** (`main` branch)
   - Linked to Vercel production deployment
   - Uses production environment variables
   - Full performance monitoring enabled

2. **Staging Environment** (`staging` branch)
   - Linked to Vercel staging/preview deployment
   - Can use same or separate environment variables
   - For now, uses same database as production (shared staging)

### Environment Variables

**Location:** Vercel Dashboard → Settings → Environment Variables

**Current Setup:**
- All critical variables (DB, API keys, Discord creds) are in Vercel as encrypted secrets
- `.env.local` contains local development copies (never commit to Git)

**To add a new variable:**
1. Go to Vercel Dashboard
2. Project → Settings → Environment Variables
3. Add variable with proper scope (Production, Preview, or Development)
4. Redeploy if needed

## Testing Workflow

### Before Merging to Main:

1. **Test in Staging:**
   - Push to `staging` branch
   - Wait for auto-deployment to complete
   - Test functionality in staging URL
   - Check Vercel build logs for errors

2. **Manual Testing Checklist:**
   - [ ] All pages load without errors
   - [ ] API endpoints return expected data
   - [ ] Error handling works correctly
   - [ ] Database transactions work
   - [ ] Discord integration functions
   - [ ] No TypeScript compilation errors

3. **Code Review:**
   - Ensure PR description is clear
   - All conversations resolved
   - At least one approval before merge

### After Merging to Main:

1. **Monitor Production:**
   - Check Vercel deployment status
   - Verify production URL is accessible
   - Monitor error logs for new issues
   - Check database for any data migration issues

2. **Rollback Plan:**
   - If critical issue found: revert commit and push to main
   - Vercel will auto-redeploy previous version
   - Or manually redeploy from Vercel dashboard

## Common Commands

```bash
# Switch to staging
git checkout staging
git pull origin staging

# Create feature branch from staging
git checkout -b feature/my-feature

# Push changes
git add .
git commit -m "Description"
git push origin feature/my-feature

# Create PR from GitHub web interface

# After PR approval and merge, verify deployment
# Go to: https://vercel.com/pizzadao/onboarding

# Deploy staging → main after validation
git checkout main
git pull origin main
git merge staging
git push origin main

# Or create a PR on GitHub for visibility
```

## Vercel Dashboard

**Project URL:** https://vercel.com/pizzadao/onboarding

**Useful features:**
- View deployment logs: Click deployment → Logs
- Revert to previous deployment: Click deployment → Redeploy
- View preview deployments: Deployments tab shows all previews
- Check build performance: Analytics tab

## Troubleshooting

### Build Failed on Staging

1. Check Vercel build logs:
   - Go to Vercel Dashboard → Deployments
   - Click failed deployment → Logs
   - Look for TypeScript errors or build issues

2. Common issues:
   - Missing environment variables → Add to Vercel
   - TypeScript errors → Fix locally, push to staging
   - Database migration issues → Check Prisma schema

### Staging URL Not Updating

1. Check Vercel deployment status (should be < 5 min)
2. Hard refresh browser (Ctrl+Shift+R)
3. Check if push actually succeeded: `git log origin/staging`

### Production Issue Found

1. **Quick fix:**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/issue-name
   # Fix the issue
   git push origin hotfix/issue-name
   # Create PR to main, merge after review
   ```

2. **Rollback if urgent:**
   - Go to Vercel Dashboard
   - Click previous successful deployment
   - Click "Redeploy"

## Best Practices

1. **Always test in staging first** before merging to main
2. **Keep staging and main in sync** - merge staging → main regularly
3. **Use meaningful branch names:**
   - `feature/user-auth`
   - `fix/profile-crash`
   - `hotfix/urgent-bug`
   - `chore/dependencies-update`

4. **Write clear commit messages:**
   - Bad: "fix stuff"
   - Good: "Fix profile page loading error in Phase 3C refactoring"

5. **Check build logs** after every deployment to catch issues early

6. **Monitor staging deployments** before promoting to production

## Next Steps

1. First PR to staging will generate preview URL
2. Add that URL to this doc
3. Set up Slack/Discord notifications (optional)
4. Create team guidelines for review process

---

For questions about this workflow, check with the development team or maintainer.

# Deployment Guide

To get your PizzaDAO Onboarding app live and running from GitHub, follow these steps.

## 1. Push to GitHub
If you haven't already, push your local code to a GitHub repository.
1. Create a new repository on GitHub.
2. Run:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git branch -M main
   git push -u origin main
   ```

## 2. Deploy to Vercel (Easiest Method)
1. Go to [Vercel](https://vercel.com/new).
2. Import your GitHub repository.
3. **Environment Variables**: This is the most critical step. Copy everything from your `.env.local` into the Vercel "Environment Variables" section:
   - `GOOGLE_SHEETS_WEBAPP_URL`: Your Apps Script URL (V8).
   - `GOOGLE_SHEETS_SHARED_SECRET`: The secret you set in Script Properties.
   - `DISCORD_CLIENT_ID`: Your Discord App ID.
   - `DISCORD_CLIENT_SECRET`: Your Discord App Secret.
   - `DISCORD_BOT_TOKEN`: Your Discord Bot Token.
   - `NEXT_PUBLIC_BASE_URL`: Your live Vercel URL (e.g., `https://onboarding.vercel.app`).
4. Click **Deploy**.

## 3. Update Discord Redirect URI
Once you have your live URL (e.g., `pizza-onboarding.vercel.app`), you **must** update your Discord Application settings:
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select your App -> **OAuth2** -> **General**.
3. Add a new Redirect URI: `https://YOUR_URL/api/discord/callback`.
4. Click **Save Changes**.

## 4. Google Apps Script Maintenance
- Your script (V8) is already live, but whenever you modify `backend_script.gs`, remember to:
  1. **Deploy** -> **New Deployment**.
  2. Select type: **Web App**.
  3. Ensure it is accessible by "Anyone".
  4. Copy the **new URL** and update it in your Vercel Environment Variables if it changes.

## Troubleshooting
If you see "Failed to save profile" on the live site:
- Check that the `NEXT_PUBLIC_BASE_URL` in Vercel exactly matches your live domain.
- Ensure the `GOOGLE_SHEETS_WEBAPP_URL` is the latest one.
- Use the **Dashboard** to verify if data is actually arriving in the sheet.

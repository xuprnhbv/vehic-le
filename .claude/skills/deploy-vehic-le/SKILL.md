---
name: deploy-vehic-le
description: Deploy the vehic-le app to Fly.io production. Use this skill whenever the user says "deploy", "push to production", "deploy the app", "ship it", "update the server", "push live", or anything about getting code changes live on Fly.io. Also use it when the user asks to deploy after making changes.
---

# Deploy vehic-le to Fly.io

## What this does

Runs `fly deploy` from the project directory to build a new Docker image and deploy it to Fly.io. The SQLite volume is untouched between deploys — only the app code changes.

## Steps

1. **Check flyctl is available.** Run `fly version`. If it's not found, stop and tell the user to install it: `winget install flyctl` or `iwr https://fly.io/install.ps1 -useb | iex`.

2. **Check for uncommitted changes.** Run `git status`. If there are uncommitted changes, ask the user whether to commit them first or deploy from the current working tree as-is. Don't commit automatically — that's the user's call.

3. **Deploy.** Run from the project directory:
   ```
   cd C:\Users\wwwid\Documents\Coding\repos\vehic-le && fly deploy
   ```
   Stream the output so the user can see build progress.

4. **Confirm success.** When `fly deploy` finishes, report whether it succeeded or failed. On success, remind the user the live URL is https://vehic-le.fly.dev.

## What can go wrong

- **Not logged in:** `fly deploy` will error with an auth message. Tell the user to run `fly auth login`.
- **App doesn't exist yet:** If this is a first deploy, the app and volume need to be created first (see the "first deploy" steps below).
- **Secrets not set:** If `SESSION_SECRET` or `APP_BASE_URL` are missing, the app will boot but sessions won't work. Remind the user to run `fly secrets set` if they haven't yet.
- **Build error:** Show the error output and help diagnose it.

## First deploy checklist (only needed once)

If the app has never been deployed before:
```
fly apps create vehic-le
fly volumes create vehic_le_data --region ams --size 1
fly secrets set SESSION_SECRET="<long-random-string>" APP_BASE_URL="https://vehic-le.fly.dev"
fly deploy
```

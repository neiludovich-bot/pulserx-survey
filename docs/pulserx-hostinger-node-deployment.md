# PulseRX Hostinger Node Deployment

Target live home:

- Survey UI: `https://pulserx.ai/mvp/customgpt-survey`
- Survey API: `https://api.pulserx.ai`
- Optional UROIQ doorway: `https://uroiq.ai/V2/surveys/brukinsa/`

Use PulseRX as the actual online runtime. Keep UROIQ as an optional public
doorway only.

## Current Check

As of the initial setup check, `pulserx.ai` did not resolve from DNS and did
not appear under the SSH-visible Hostinger domains directory. Wait for DNS/site
provisioning or confirm which Hostinger account/server the new site was created
on before uploading runtime files.

The current UROIQ shared-host shell has no `node`, `npm`, or `pnpm`, so it
cannot run the survey runtime directly. PulseRX needs to be configured as a
Hostinger Node.js web app, or deployed on a Node-capable host and pointed at
from PulseRX.

## Preferred Hostinger Shape

Create two Node apps:

1. `pulserx.ai` for the Next.js browser UI
2. `api.pulserx.ai` for the Fastify API

This keeps the runtime simple:

- one process for the browser app
- one process for the API
- server secrets only in the API app
- no API keys in PHP/public folders

## GitHub Deployment

GitHub deployment is preferred over ZIP upload because redeploys are repeatable
and Hostinger can pull the same repo for both apps.

Use the same GitHub repository for both Hostinger Node apps, but configure each
app with different build/start scripts.

API app:

```bash
Build command: npm run build:api
Start command: npm run start:api
```

Web app:

```bash
Build command: npm run build:web
Start command: npm run start:web
```

The root `package.json` scripts call `corepack pnpm --filter ...` internally, so
Hostinger can run normal npm scripts while the monorepo still uses pnpm.

## Database

Use a managed Postgres database. Supabase or Neon are both fine.

Set `DATABASE_URL` to the pooled production connection string. Keep SSL
enabled if the provider requires it.

After first deploy, run:

```bash
corepack pnpm db:push
corepack pnpm db:seed
```

For the MVP smoke test, some BRUKINSA survey state is still in memory/JSONL, but
production pilot work should move that durable state fully into Postgres before
real respondents.

## API App

Hostinger Node app:

- Domain/subdomain: `api.pulserx.ai`
- App root: repository root
- Node version: 20+
- App port: `3001` unless Hostinger assigns a different one
- Install command:

```bash
corepack enable && corepack pnpm install --frozen-lockfile
```

- Build command:

```bash
npm run build:api
```

- Start command:

```bash
npm run start:api
```

Environment:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
CORS_ORIGIN=https://pulserx.ai
DATABASE_URL=postgresql://...
CUSTOMGPT_API_BASE_URL=https://app.customgpt.ai/api/v1
CUSTOMGPT_API_KEY=...
CUSTOMGPT_PROJECT_ID=...
OPENAI_API_KEY=...
VOICE_LANGUAGE=en
OPENAI_MODEL_TRANSCRIPTION=gpt-4o-transcribe
OPENAI_MODEL_TTS=gpt-4o-mini-tts
OPENAI_MODEL_REALTIME=gpt-realtime
```

Smoke test:

```text
https://api.pulserx.ai/health
```

Expected response:

```json
{"status":"ok","service":"api"}
```

## Web App

Hostinger Node app:

- Domain: `pulserx.ai`
- App root: repository root
- Node version: 20+
- App port: `3000` unless Hostinger assigns a different one
- Install command:

```bash
corepack enable && corepack pnpm install --frozen-lockfile
```

- Build command:

```bash
npm run build:web
```

- Start command:

```bash
npm run start:web
```

Environment:

```bash
NODE_ENV=production
NEXT_PUBLIC_API_BASE_URL=https://api.pulserx.ai
NEXT_PUBLIC_BASE_PATH=
```

Smoke test:

```text
https://pulserx.ai/mvp/customgpt-survey
```

## Optional UROIQ Doorway

Once PulseRX is live, create this file on UROIQ:

`/home/u832889812/domains/udobot.net/public_html/V2/config/survey_public.php`

```php
<?php
declare(strict_types=1);

return [
  'brukinsa' => [
    'app_url' => 'https://pulserx.ai/mvp/customgpt-survey',
    'mode' => 'iframe',
  ],
];
```

Then this URL becomes a same-UROIQ public doorway:

```text
https://uroiq.ai/V2/surveys/brukinsa/
```

## Before Pilot Respondents

- Move MVP survey session state and turn audits into Postgres.
- Add public endpoint rate limiting.
- Add respondent/session tokens so the public URL is open but not an unlimited
  anonymous API.
- Keep source/citation decisions persisted for replay.
- Run regression/eval fixtures for active disease lane, multi-factor follow-up,
  proactive source context, terminal close, and citation/asset behavior.

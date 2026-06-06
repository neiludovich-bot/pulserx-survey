# UROIQ Public Survey Deployment

This note describes the preferred way to place the adaptive survey on the same
public site as UROIQ while keeping it outside the login flow.

## Recommended Shape

- Public UROIQ path: `/surveys/brukinsa/`
- Public entry file: `deploy_hostinger/public/surveys/brukinsa/index.php`
- Hosted survey app: the Next.js survey UI, deployed as a Node app
- Hosted API: the Fastify API, deployed as a Node app
- Database: managed Postgres for durable sessions, turn history, extracts, and
  replay/debug metadata

The UROIQ public folder should only know the hosted survey app URL. CustomGPT,
OpenAI, database, and model configuration keys stay on the Node/API host.

## Why Not Put The Whole MVP In A PHP Subfolder?

The MVP is not a static PHP page. It needs:

- server-side API calls to CustomGPT and OpenAI
- browser-to-API requests for turns, voice transcription, speech, and source
  previews
- persistent interview state
- rate limits and CORS controls
- audit/replay logs

Putting keys or interview logic directly into a public UROIQ folder would make
the survey fragile and unsafe. The public UROIQ folder should be only the
doorway.

## Hostinger Options

### Shared PHP Hosting

Use the provided public subfolder page as an iframe wrapper:

1. Deploy the Next/Fastify survey app to a Node-capable host.
2. Set the hosted web app URL in `deploy_hostinger/config/survey_public.php`.
3. Upload `deploy_hostinger/public/surveys/brukinsa/index.php`.
4. Visit `/surveys/brukinsa/` on the UROIQ site.

This gives users a same-site public URL while the survey runtime lives where
Node is supported.

Current UROIQ shared hosting check: SSH access to `udobot.net` is available,
but `node`, `npm`, and `pnpm` are not installed on that host. Treat the live
UROIQ folder as the public doorway only unless the hosting plan is upgraded to a
Node-capable plan or VPS.

### VPS Or Node-Capable Hosting

Use a reverse proxy so `/surveys/brukinsa/` maps directly to the Next app and
`/surveys-api/` or a private upstream maps to Fastify. This is the cleanest
single-domain setup, but it requires server-level web configuration.

## Production Environment

Web app:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-api-host.example.com
```

API:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
CORS_ORIGIN=https://your-uroiq-domain.example.com
DATABASE_URL=postgresql://...
CUSTOMGPT_API_KEY=...
CUSTOMGPT_PROJECT_ID=...
OPENAI_API_KEY=...
VOICE_LANGUAGE=en
```

For the public UROIQ page, create:

```php
<?php
declare(strict_types=1);

return [
  'brukinsa' => [
    'app_url' => 'https://your-survey-web-host.example.com/mvp/customgpt-survey',
    'mode' => 'iframe',
  ],
];
```

## Before Calling This Production

- Move MVP in-memory session state to Postgres.
- Store every survey turn, source context decision, citation set, and structured
  extraction in durable tables.
- Add rate limiting for the public start/turn/voice endpoints.
- Lock CORS to the live UROIQ origin and expected local dev origins only.
- Add a public consent/market-research notice and no-PHI reminder.
- Add a respondent session token or study-link token so the public route is open
  but not an unlimited anonymous API.
- Add replay/eval fixtures for the lane-control, multi-factor follow-up, source
  grounding, terminal-close, and citation/asset behaviors.

## Repeatable Bot Rule

For future survey bots, keep the public mount the same and change only:

- the public subfolder name
- the hosted app route or study ID
- the study guide/SOP
- the CustomGPT project/source library
- the typed selection, phrasing, extraction, and source-context contracts

Do not put bot-specific business rules into the public PHP wrapper.

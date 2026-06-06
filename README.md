# PulseRX Survey

Adaptive medical survey runtime for PulseRX.

## Hostinger Apps

Deploy the same repository twice:

- `pulserx.ai` for the Next.js web app
- `api.pulserx.ai` for the Fastify API

API app:

```bash
Install: corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm install --frozen-lockfile
Build: npm run build:api
Start: npm run start:api
```

Web app:

```bash
Install: corepack enable && corepack prepare pnpm@9.15.0 --activate && pnpm install --frozen-lockfile
Build: npm run build:web
Start: npm run start:web
```

See `docs/pulserx-hostinger-node-deployment.md` for environment variables and
deployment notes.


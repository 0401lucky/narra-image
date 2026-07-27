# Narra Image

A high-aesthetic image generation website for general users.

> Live Site: [narralucky.c0ffee.space](https://narralucky.c0ffee.space) ｜ Repository: <https://github.com/0401lucky/narra-image> ｜ License: [AGPL-3.0](#开源协议)

Core Features:

- Homepage driven by the generator, supplemented by a creation feed.
- Registration via Email + Password + Invite Code, supporting a public invite code redemption page.
- LinuxDo OAuth third-party login (can be toggled in the admin panel).
- Cloudflare Turnstile CAPTCHA (covering Login / Registration / Invite Code Redemption).
- Daily check-in credit incentives, with batch credit distribution via redemption codes.
- Built-in channels deduct credits by default, defaulting to `5` credits per generation.
- New users receive `500` credits by default.
- Multi-channel generation: Built-in channels + user-provided OpenAI-compatible channels.
- Supports fetching public model lists from compatible channels based on `Base URL + API Key`.
- The creation studio supports `gpt-image-2`'s 1K / 2K / 4K / custom size, quality, and output format parameters.
- Works Gallery: User submissions, administrator review, and curated likes.
- Admin Panel: User management, invite codes, redemption codes, generation records, rewards, work moderation + system settings (Login sources / CAPTCHA / Generation channels).
- Built on `Next.js + Prisma + PostgreSQL`, supporting `Docker` deployment to `Zeabur`.
- Image generation tasks are consumed by a separate `Go Worker`; Next.js handles task submission and pages/APIs.
- The progressive migration plan for the Go backend can be found in [`docs/go-backend-migration-plan.md`](docs/go-backend-migration-plan.md).

## Local Development

1. Install dependencies

```bash
pnpm install
```

2. Copy environment variables

```bash
cp .env.example .env
```

3. Generate Prisma Client

```bash
pnpm db:generate
```

4. Push database schema

```bash
pnpm db:push
```

5. Initialize invite codes (Set `BOOTSTRAP_INVITE_CODE` explicitly in `.env` first)

```bash
pnpm db:seed
```

6. Start development environment

```bash
pnpm dev
```

## Key Environment Variables

- `DATABASE_URL`: PostgreSQL connection string.
- `AUTH_SECRET`: Secret for session signing and encryption of user-provided channels.
- `BUILTIN_PROVIDER_BASE_URL`: Built-in OpenAI-compatible gateway address.
- `BUILTIN_PROVIDER_API_KEY`: Built-in channel API key.
- `BUILTIN_PROVIDER_MODEL`: Default model for the built-in channel, `gpt-image-2` is recommended.
- `BUILTIN_PROVIDER_CREDIT_COST`: Credits consumed per use of the built-in channel.
- `S3_*`: Object storage configuration (optional).
- `NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS`: List of image domains to bypass Next Image optimization; suitable for self-hosted CDNs resolving to internal/reserved addresses.
- `ENABLE_EMBEDDED_WORKER`: Allows a single deployment container to start both Next.js and the Go Worker. Recommended to be `true` for single-service deployments on Zeabur.
- `WORKER_*`: Configuration for Go image worker concurrency, polling interval, task timeout, and max retries.
- `BOOTSTRAP_ADMIN_EMAIL`: Email address to be automatically promoted to administrator.
- `BOOTSTRAP_INVITE_CODE`: Initial invite code.

## Prompt Library Synchronization

The prompt library's frontend and backend management are provided by Next.js. Go synchronization commands are also provided for fetching prompts from GitHub, suitable for one-time deployment tasks or cron jobs:

```bash
pnpm prompt:sync
```

Sync from a single source:

```bash
pnpm prompt:sync -- -source awesome-gpt-image
```

The Docker image also includes `/app/narra-prompt-sync`, which can be executed within the container environment by connecting to the same `DATABASE_URL`.

## Testing and Building

```bash
pnpm test
pnpm lint
pnpm build
```

## Docker Compose Deployment

```bash
docker compose up --build -d
```

When deploying to `Zeabur`, it is recommended to provide:

- A `PostgreSQL` service.
- Use the `Dockerfile` in the repository root for the application service.
- Configure `DATABASE_URL`, `AUTH_SECRET`, and built-in channel environment variables before running.
- If deploying only one application service, keep `ENABLE_EMBEDDED_WORKER=true`; the container will start both Next.js and the Go Worker.

If you use `docker compose` locally, it will start the following by default:

- `app`: Narra Image application.
- `worker`: Go image worker, which consumes pending generation tasks from the database.
- `db`: PostgreSQL 17.

The container will automatically prepare the database upon startup: new empty databases will have the current schema created first, while existing databases will take over the migration history and then apply new migrations from the repository.
The current production startup flow will not proactively execute `seed` to avoid additional memory spikes caused by `tsx prisma/seed.ts` in low-memory environments.
The registration interface will only create the initial invite code if `BOOTSTRAP_INVITE_CODE` is explicitly configured; administrators specified by email must also use a valid invite code to register.

## About Model Fetching

- Now supports calling the **OpenAI-compatible** `/models` endpoint using `Base URL + API Key` to fetch the model list.
- This is applicable to the `OpenAI Images API` and certain Gemini / third-party gateways that implement OpenAI compatibility.
- If a channel has not implemented `/models` or the implementation is incomplete, the admin panel and creation page will prompt you to enter the model name manually.
- What is fetched is the "channel's public model list," and it is not guaranteed that every model can generate images; the interface will prioritize IDs that look more like image generation models.

## System Settings

Low-frequency but critical configurations are unified under `/admin/settings`:

- **Login Sources**: Configure third-party OAuth logins such as LinuxDo.
- **CAPTCHA**: Cloudflare Turnstile, with independent toggles for Login / Registration / Invite Code Redemption / Image Generation. See the prompts within the admin page for the configuration process. Apply for credentials at: <https://developers.cloudflare.com/turnstile/get-started/>
- **Generation Channels**: Manage multiple OpenAI-compatible API channels, including enabling/disabling, changing keys, and adjusting credit costs.

## 开源协议

This project is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](./LICENSE) for details.

- ✅ Free to read, use, modify, self-deploy, and redistribute.
- ✅ No issues with academic research, private projects, or internal use.
- ⚠️ **If you modify the code and provide it as a network service** (not just distributing source code), you must also open-source your modifications under AGPL-3.0.
- ⚠️ Commercial closed-source / SaaS deployments require a separate commercial license.

For commercial licensing or partnership inquiries, please contact via [GitHub Issues](https://github.com/0401lucky/narra-image/issues).

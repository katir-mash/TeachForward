# Render Free Web Service with Upstash Redis

This guide describes the production setup; the repository has not been deployed by these instructions. Creating or enabling hosting resources is a separate owner action. No payment integration is part of TeachForward.

Keep the existing architecture: one Node.js/Express service serves both the Vite production build and `/api` on the same HTTPS origin. Do not create a Render Static Site for the full app, and do not deploy only `dist/`.

## Before creating a service

Production requires an owner-configured **Upstash Redis** database. Access IDs, manual and demo Plus entitlements, the public demo setting, identity-creation admission, daily browser/network/service AI quotas, pending reservations and shared security rate limits live in Redis. The Render filesystem is never used for important production state. Development without Redis can still use local JSON stores.

Choose Render Free and Upstash Free only after reviewing current provider/account limits; no account, plan or database is created by this code. Do not enable an automatic paid upgrade. Free services can sleep, be limited or become unavailable, so this setup is for an MVP demonstration within those limits, not an availability guarantee. A Render persistent disk is not required. Render Free files remain ephemeral; Render Free Key Value also loses its in-memory state on restart and is not a durable substitute. [Render Free limitations](https://render.com/docs/free).

Keep Upstash **eviction disabled**: this database holds durable application state, not disposable cache entries. Enabling eviction or deleting keys can remove quotas or access grants. Keep the same database and stable signing secret across redeploys, and maintain a private backup/recovery plan. The fixed application namespace is `teachforward:v1`; do not flush or change production keys to clear limits. Use a separate database for tests. [Upstash eviction](https://upstash.com/docs/redis/features/eviction).

Keep **one service instance and one Node process** for the current temporary chat and administrator-login sessions. Durable store mutations and quota reservations coordinate atomically in Redis.

## Service settings

Once the owner has chosen and authorized the hosting resources, create a **Web Service** from the TeachForward repository. Use these settings:

| Render field | Value |
| --- | --- |
| Language | Node |
| Compute | Free, selected by the owner |
| Branch | The reviewed production branch |
| Root Directory | Leave blank: use the repository root containing `package.json` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instances | `1` |
| Persistent disk | None |

Render runs Linux, so these hosted commands use `npm`. In local Windows PowerShell use `npm.cmd`. The server reads the host's `PORT` and listens for incoming requests; do not hardcode the local development port in Render. [Render web services and port binding](https://render.com/docs/web-services).

## Upstash storage

The owner must create or select an Upstash Redis database, keep eviction off and privately obtain its HTTPS REST URL and **read/write** REST token. Copy those into Render Environment. Never send credentials to the developer/chat or expose them in frontend variables. Provider quota, permission and availability failures block storage-dependent access changes and paid AI requests rather than falling back to files or memory. [Official SDK setup](https://upstash.com/docs/redis/sdks/ts/getstarted).

`DATA_DIRECTORY`, `ACCESS_DATA_FILE`, `USAGE_DATA_FILE` and `PERSISTENT_STORAGE_CONFIRMED` are **not production settings anymore**. Remove them from Render and old private import files. Local paths remain development-only options. Every production run, including a local production preview, requires Upstash; an old disk acknowledgement cannot bypass missing Redis.

Existing local JSON records are not uploaded automatically. If existing manual grants need to be retained, plan a reviewed migration before launch; do not publish private JSON data or reset production counters. This change includes no automatic file-to-Redis migration.

## Server environment and secrets

Set runtime values in Render's **Environment** settings, not in React code, `public/`, `VITE_*` variables or a committed configuration file. Keep local `.env` and `server/admin-access.txt` private. Use the administrator password hash created by local setup; the plaintext administrator password does not belong in the hosted environment.

Use the following settings for the single native Node service. Replace the origin with its actual Render URL; do not copy the illustrative hostname literally.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Optional on Render: exact custom HTTPS origin; otherwise validated `RENDER_EXTERNAL_URL` is used |
| `SESSION_SECRET` | A private stable random secret of at least 32 characters; retain the same value across deploys |
| `ADMIN_PASSWORD_HASH` | The private scrypt hash generated by local `npm.cmd run setup:admin` |
| `UPSTASH_REDIS_REST_URL` | Database HTTPS REST origin, copied privately from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Private read/write REST token for that database |
| `OPENAI_API_KEY` | Set privately to enable Mentor; omit for an honest AI-unavailable deployment |
| `OPENAI_MODEL` | `gpt-6-luna`, or another Responses model verified for the configured key |
| `OPENAI_MAX_RETRIES` | `1` normally; `0` for a deliberately single-attempt authorized live check |
| `AI_DAILY_REQUEST_LIMIT` | `100` by default: service-wide daily provider-attempt slots |
| `AI_IP_DAILY_REQUEST_LIMIT` | `30` by default: daily provider-attempt slots per network |

Render supplies `PORT`, `RENDER` and `RENDER_EXTERNAL_URL`. The app binds `0.0.0.0`; do not force local port 3001. A nonempty explicit `APP_ORIGIN` takes priority over `RENDER_EXTERNAL_URL`. Custom origins must contain only HTTPS protocol, host and optional port, with no credentials, path, query or fragment. Browser mutation requests use only this configured origin. [Render default variables](https://render.com/docs/environment-variables).

Plain `npm start` is sufficient. The Linux command `APP_ORIGIN="$RENDER_EXTERNAL_URL" npm start` also works with a valid Render HTTPS URL. Empty or malformed addresses, public HTTP, a short/missing signing secret, and missing Redis credentials still block production startup. A local production preview can use an explicit loopback HTTP origin but still requires Redis. No protection is disabled and there is no production filesystem bypass. Build before starting so frontend assets exist.

The public app does not read a developer's local `server/.env` after deployment. Save and deploy changes before expecting the running process to use them; Render's **Save only** option postpones activation until the next deploy. Private Render import files must be ignored by Git and must not be shared. [Render environment variables](https://render.com/docs/configure-environment-variables).

The repository's `.node-version` pins the tested **26.13.1**, and `package.json` bounds supported versions to `>=22.12 <27`. Leave Render's `NODE_VERSION` unset to use the repository pin; an existing `NODE_VERSION` overrides it. Do not set an unbounded latest version. [Render Node.js versions](https://render.com/docs/node-version).

## IP limits behind the host proxy

Network quotas need the real client address, not one shared proxy address. Render documents Cloudflare and load-balancer forwarding through `x-forwarded-for`. Configure `TRUST_PROXY=1` only if the verified path has exactly one trusted hop at the application boundary; the app does not trust arbitrary forwarded headers by default. If the actual chain differs, adapt the trusted-proxy configuration before relying on per-network limits. Verify that separate test clients are not all grouped into one proxy bucket and that forged forwarded headers do not bypass limits. Do not expose a trusted-proxy deployment directly. The persisted service-wide attempt cap remains independent of IP buckets. [Render client-IP guidance](https://render.com/articles/how-render-handles-ddos-attacks#reading-the-true-client-ip).

## Durable quota behavior

Every provider-bound Mentor request saves a reservation **before** contacting OpenAI: one browser question plus `1 + OPENAI_MAX_RETRIES` possible attempt slots for both the network and service. With one retry allowed, one question reserves two slots even if the first attempt succeeds. The browser allowance is up to 3 questions per UTC day for Free or 20 for Plus, subject to remaining network/service slots.

Only the browser question is refunded after a recorded failure; network and global attempt slots are never refunded on failures, unused retries or restarts. A crash after reservation conservatively leaves it counted. Daily Redis quota keys expire after their accounting window is no longer needed. Atomic Lua checks prevent parallel callers, new browser cookies or a different network from exceeding the shared cap. Raising limits or deleting/resetting keys is an operator change, not normal error recovery. These limits bound possible request attempts; they do not promise a particular dollar bill.

The official Upstash SDK has a bounded request timeout and automatic mutation retries disabled. An ambiguous network result does not cause an unreserved OpenAI request, a local fallback or an unverified Plus grant. During a runtime Redis outage, an already loaded questionnaire, deterministic roadmap and browser-saved progress remain usable, with clear API errors for unavailable server features. At startup, failed Redis PING or access cleanup prevents the backend from binding its port, so frontend assets are not served until storage recovers and the service starts successfully. [SDK timeouts](https://upstash.com/docs/redis/sdks/ts/advanced), [SDK retries](https://upstash.com/docs/redis/sdks/ts/retries).

New browser identities also use persisted rolling admission limits and inactive-record retention:

| Optional setting | Default |
| --- | --- |
| `ACCESS_ID_IP_BURST_LIMIT` | `5` new identities per network per 10 minutes |
| `ACCESS_ID_IP_DAILY_LIMIT` | `40` per network per rolling 24 hours |
| `ACCESS_ID_GLOBAL_HOURLY_LIMIT` | `100` service-wide per hour |
| `ACCESS_ID_GLOBAL_DAILY_LIMIT` | `1000` service-wide per rolling 24 hours |
| `ACCESS_ID_IDLE_DAYS` | `30` days since the latest of last seen, recorded manual expiry or recorded demo expiry |
| `ACCESS_ID_MAX_RECORDS` | `10000`, also the hard maximum |

Active manual and demo grants are protected from inactive-record cleanup. At capacity, the service rejects new identities rather than evicting existing active grants. These controls limit cookie-reset abuse; they are not visitor registration or a cross-device identity system.

## After deployment

1. Open the HTTPS origin and verify that the landing page, questionnaire and roadmap load together with `/api/health`.
2. Check a task, refresh, and confirm that browser progress remains intact. An API health response reports process/configuration information; it does not call OpenAI or check current Redis availability.
3. Open `/admin`, sign in privately, and test a manual Plus grant and revocation for a test browser's Access ID. Test the public demo setting separately.
4. Redeploy once during a controlled check and verify that the same browser retains its Access ID, Plus entitlement and daily counters in Redis. Administrator login and recent chat are intentionally temporary, so sign in again as needed. Confirm that separate cookie identities still share the network/global budgets.
5. Only when the owner authorizes provider usage, send one short Mentor question and confirm its real answer in the interface. Automated tests use offline transport and do not establish live provider access.

These checks establish this particular deployment's observed behavior. They do not guarantee continuing provider availability or certification outcomes.

Automated Redis tests execute the exact application Lua scripts in an offline Lua interpreter with a Redis-command fixture; official SDK tests use mocked HTTP responses. They check application behavior, not compatibility or availability of a live Redis/Upstash database. A real owner-configured database still needs a deployment check.

## Backups and recovery

Retain the stable `SESSION_SECRET` and Upstash credentials in private secret storage, with a recovery plan for the Redis database. Access metadata and quota/admission data must be preserved together. Restoring grants without quota reservations can weaken daily limits. Do not flush the database, reset counters or rotate the signing secret to clear quota or administrator login problems.

If Redis is unavailable, reaches a provider cap or rejects a write, investigate without enabling eviction, deleting keys or replacing storage with an empty local file. Restore data and secret configuration before restarting, then repeat non-billable health and administrator checks. Changing the signing secret invalidates the link to existing anonymous identities.

Official Render and Upstash documentation was reviewed on **November 15, 2026**. No live Upstash database, Render service, disk, paid plan or deployment was created as part of preparing this file.

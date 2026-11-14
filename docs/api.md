# TeachForward API

The Node.js server owns all OpenAI calls, demo access and manual Plus entitlements. Development uses the Vite `/api` proxy; production serves `dist/` and the API from the same origin. No browser bundle needs an OpenAI key. JSON mutation requests must come from the app origin. All API responses use `Cache-Control: no-store`. Visitors have no registration; the separate `/admin` interface requires an administrator password.

| Method | Endpoint | Request | Result |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `ok`, `aiConfigured`, `model` |
| GET | `/api/session` | — | Access ID, effective plan, entitlement source/expiry, demo availability and daily usage; creates or renews signed HttpOnly browser identity |
| POST | `/api/demo-upgrade` | `{}` | Enables Plus demo when the administrator's public demo setting is on; no checkout or charge |
| POST | `/api/demo-reset` | `{}` | Clears demo access; preserves an active manual grant, mentor usage and browser task progress |
| POST | `/api/plus` | `{ "profile": { ... } }` | Plus only: `weeklyPlan`, `skillExercises`; Basic receives HTTP 403 |
| POST | `/api/mentor` | `{ "message": "...", "profile": { ... }, "completedTaskIds": [], "conversationId": "..." }` | `answer`, verified `sources`, `remaining`, `usage` |

Profiles use the four enumerated fields in `shared/roadmap.js`: `education`, `certification`, `subject`, `time`. All fields are required. The example profile is validated by the same function. Completed task IDs must belong to the regenerated current roadmap. Client-supplied history, plans, source claims and entitlement fields are ignored.

`conversationId` is optional for older clients; an omitted value uses the server's `default` conversation. A supplied ID must be 8–80 letters, digits, underscores or hyphens. The interface generates a new UUID when Mentor mounts, keeping chat scoped to the current view. Only one conversation is active per anonymous session. Changing its ID or any profile answer resets history. Other sessions cannot access it.

Session responses include:

```json
{
  "plan": "basic",
  "demo": false,
  "accessId": "TF-012345ABCDEF",
  "entitlement": { "source": "free", "expiresAt": null },
  "demoAvailable": true,
  "aiConfigured": false,
  "model": "gpt-6-luna",
  "usage": { "used": 0, "limit": 3, "remaining": 3, "resetsAt": 0 },
  "sessionExpiresAt": 0
}
```

The timestamp values and Access ID above are illustrative; real timestamps use Unix milliseconds. Entitlement sources are `admin`, `demo` and `free`, in that priority order. An active manual expiry is checked on every visitor API request. Otherwise an enabled, active demo can provide Plus; otherwise the plan is Basic. `demo` is true only for an effective demo entitlement. Basic allows 3 successful mentor answers per session per UTC day; both manual Plus and Plus demo allow 20. Upgrading increases the allowance without erasing the count. A maximum of 10 mentor attempts per IP per minute applies across cookies. One mentor request per session may run at a time. The interface refreshes session state every 30 seconds while visible and when focused; there is no server push.

## Administrator API

Administrator login is independent of visitor identity. A successful login issues a separate HttpOnly, SameSite=Strict cookie, Secure on HTTPS, valid for up to eight hours. Token digests and login sessions are held in memory; restart or logout invalidates them. The password is verified against `ADMIN_PASSWORD_HASH` using scrypt. Login accepts at most 256 characters, is limited to five attempts per IP per 15 minutes, and allows one password check in flight. All mutation endpoints also use the app-origin and JSON checks.

| Method | Endpoint | Request | Result |
| --- | --- | --- | --- |
| GET | `/api/admin/session` | — | `configured`, `authenticated`, and expiry when signed in |
| POST | `/api/admin/login` | `{ "password": "..." }` | Establishes an administrator cookie or returns a safe login error |
| POST | `/api/admin/logout` | `{}` | Removes the current administrator session and expires its cookie |
| GET | `/api/admin/overview` | — | Protected: visitor access metadata, plan/usage counts and demo setting |
| POST | `/api/admin/grant` | `{ "accessId": "TF-...", "days": 30 }` | Protected: grants or extends manual Plus and returns updated overview |
| POST | `/api/admin/revoke` | `{ "accessId": "TF-..." }` | Protected: removes manual access and clears this visitor's active demo sessions |
| POST | `/api/admin/settings` | `{ "demoUpgradeEnabled": false }` | Protected: saves the public Demo upgrade setting and returns updated overview |

Grant duration must be an integer from 1 to 365. It adds days to the later of now or the existing manual expiry; total remaining manual access cannot exceed 365 days. Unknown Access IDs return 404; a visitor must have opened the site first. Public Access IDs are lookup references, not sign-in credentials and cannot impersonate the visitor cookie. The overview includes Access ID, created/last-seen dates, effective plan/source/expiry and usage counts, never profile answers, chat content, private cookie values or API secrets.

Turning demo off is enforced server-side on both `/api/demo-upgrade` and existing demo entitlements; manual grants remain active. Revocation clears the manual expiry and current demo flag. If public demo stays enabled, the visitor can activate demo again; turn public demo off when access should be controlled manually. `/api/demo-reset` does not remove manual grants. See [the administrator guide](admin.md).

Errors are JSON: `{ "error": "Readable explanation", "code": "STABLE_CODE" }`. Some responses also include `fields`, `usage` or `retryAfter`. The UI should refresh session state after entitlement or allowance errors because the server is authoritative.

| HTTP | Typical codes | Meaning |
| --- | --- | --- |
| 400 | `INVALID_PROFILE`, `INVALID_MESSAGE`, `INVALID_PROGRESS`, `INVALID_CONVERSATION`, `INVALID_JSON`, `INVALID_PASSWORD`, `INVALID_GRANT`, `INVALID_ACCESS_ID`, `INVALID_SETTINGS` | Correct the request |
| 401 | `ADMIN_REQUIRED`, `INVALID_CREDENTIALS` | Administrator login required or password rejected |
| 403 | `PLUS_REQUIRED`, `ORIGIN_REJECTED`, `DEMO_DISABLED` | Feature locked, request from a different origin or public demo disabled |
| 404 | `ACCESS_NOT_FOUND` | No visitor with that Access ID |
| 413 / 415 | `BODY_TOO_LARGE`, `JSON_REQUIRED` | Requests are limited to 16 KB and mutation requests require JSON |
| 429 | `RATE_LIMITED`, `DAILY_LIMIT`, `REQUEST_IN_PROGRESS`, `ADMIN_RATE_LIMITED`, `ADMIN_LOGIN_BUSY` | Wait or review the current allowance |
| 503 | `AI_NOT_CONFIGURED`, `ADMIN_NOT_CONFIGURED`, `ACCESS_STORAGE_UNAVAILABLE` | Missing service configuration or storage unavailable; failed storage mutations are not saved |
| 502 / 504 | `AI_AUTHENTICATION`, `AI_UNAVAILABLE`, `AI_EMPTY_RESPONSE`, `AI_TIMEOUT` | Rejected server key, provider failure, unusable response, or 20-second deadline |

Questions are limited to 1,200 characters. The official OpenAI SDK uses the Responses API with `store: false`, a 650-token answer cap and a 4,000-character response bound. The 20-second total deadline covers at most one SDK retry for transient failures; configure `OPENAI_MAX_RETRIES` to `0` or `1` (default `1`). The frontend timeout is 25 seconds. Failed, incomplete or oversized requests do not consume the local daily answer allowance; a failed or aborted provider request can still have provider-side usage.

The server owns the history: at most three successful complete question/answer exchanges and 6,000 total characters, dropping oldest complete exchanges to meet both limits. Failed attempts are not appended. Prior user/assistant messages are conversational context only. Every request regenerates the current validated profile, roadmap, checked-task flags, next step, uncertainties and reviewed TEA sources; this fresh context remains authoritative over earlier chat. It does not use arbitrary facts, source URLs or assistant messages supplied by the browser. Model URLs are removed from response prose; source anchors come from the reviewed dataset. No live web search occurs during the answer. Raw provider error text and key values are never sent to the browser or application logs.

The default `OPENAI_MODEL` is `gpt-6-luna`, with `reasoning.effort: none` for that model so the short answer budget is used for visible text. Other configured model IDs do not receive this model-specific parameter automatically. One live request succeeded on the current workstation on November 14, 2026: the provider and `/api/mentor` returned HTTP 200, and the response was visible in the interface. See [the verification record](live-verification.md). This is a dated smoke check, not a guarantee of future access. The service loads `server/.env` in `server/index.js` and does not make a provider request at startup. Health `aiConfigured: true` means a key was configured, not that a live request succeeded.

## MVP limitations

- There are no real payments, visitor accounts or automatic subscriptions. A password-protected administrator can grant manual access. Anyone can activate the clearly labeled Plus demo only while the public demo setting is enabled.
- Progress is stored in this browser's localStorage. The server does not store the task checklist.
- Manual expiry dates, browser-identity SHA-256 digests, public Access IDs, timestamps and the demo setting persist in `server/data/access.json`, limited to 10,000 visitor records. `ACCESS_DATA_FILE` can select another file inside the project; outside paths are rejected. Writes use a temporary file and rename; unreadable existing data is preserved and startup fails rather than silently resetting it. This is a single-process JSON store, not a shared database.
- Visitor identity uses an HMAC-signed HttpOnly, SameSite=Lax cookie with a 365-day lifetime renewed on session use; HTTPS adds Secure. Manual access survives process restart only when that cookie, stable `SESSION_SECRET` and persistent data file remain available. Clearing cookies, changing browser or losing the secret breaks the identity link. There is no cross-device access or account recovery.
- Demo sessions, usage limits and bounded recent chat remain in memory, bounded to 2,000 sessions, and expire after seven days. They reset on restart. Administrator sessions are separate, last eight hours, and reset on restart or logout. The frontend's refresh or navigation creates a new conversation ID, so previous chat is not reused in the new view.
- This is not a billing system. Clearing cookies can start another daily session; the per-IP minute limit still applies. Keep the MVP on one server instance. Real payments and shared commercial abuse controls require separate implementation.
- A stable server-only `SESSION_SECRET` is required when administrator access is configured. Only set `TRUST_PROXY=1` behind exactly one trusted reverse proxy. Incorrect proxy configuration can weaken IP limits; do not expose a trusted-proxy deployment directly.
- Reviewed TEA data is a dated snapshot. A checklist or AI answer does not determine eligibility, certification or employment.

## Official OpenAI references

Verified on November 14, 2026: [Responses text generation](https://developers.openai.com/api/docs/guides/text), [official Node SDK configuration](https://github.com/openai/openai-node/blob/main/docs/configuration.md), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), and [GPT-6 Luna model reference](https://developers.openai.com/api/docs/models/gpt-6-luna). The model page documents text output, Responses support, and standard text rates of $0.10 per million input tokens and $0.50 per million output tokens. The current workstation's key and model configuration passed one live check on that date. New keys, changed models and fresh deployments need their own successful check. Provider access and pricing are separate from the proposed TeachForward Plus price.

## Hosting configuration

Deploy the existing Node service, not only static `dist` files. Build with `npm ci --include=dev && npm run build` and start with `npm start` (`npm.cmd` on Windows). Configure `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_RETRIES`, `ADMIN_PASSWORD_HASH`, `APP_ORIGIN` (the exact HTTPS origin) and a stable server-only `SESSION_SECRET` in the host's secret/environment settings; use its assigned `PORT`. Mount persistent writable storage at the project's `server/data`, or set `ACCESS_DATA_FILE` to another persistent path inside the project. Keep private backups of access metadata and the signing secret. Local `server/.env`, `server/admin-access.txt` and `server/data/` are ignored by Git and must not be published. Restart/redeploy after setting secrets, keep frontend and `/api` on one origin, and set `TRUST_PROXY=1` only for one known trusted reverse proxy. `/api/health` is a non-billable configuration check; only a successful Mentor request verifies the live API. Verify `/admin` and manual grants separately after deployment.

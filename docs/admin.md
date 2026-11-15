# Administrator and manual Plus access

The administrator can grant, extend or revoke Plus for a browser's Access ID and control public Demo upgrade. There is no payment processor, charge, automatic renewal or visitor registration.

## Open the administrator page

Use **http://127.0.0.1:5173/admin** with `npm.cmd run dev`, or **http://127.0.0.1:3001/admin** with the local production server. The public site footer also links to `/admin`. The page requires a separate administrator password; ordinary visitors remain anonymous.

From PowerShell in the TeachForward folder, initial setup is:

```powershell
npm.cmd run setup:admin
```

The setup command verifies that secret files are ignored and untracked by Git. It generates a random password, stores its scrypt hash as `ADMIN_PASSWORD_HASH` in `server/.env`, and creates a stable `SESSION_SECRET` if one is missing. Existing OpenAI settings and any existing signing secret are preserved. A configured administrator is preserved on later setup runs; the command does not reset its password.

After setup, open `server/admin-access.txt`, relative to the repository root, privately in your editor for the generated password. This Git-ignored file is created locally and is not part of a fresh checkout.

The password is not printed by setup. Do not paste this file, the password, password hash or `.env` contents into chat, logs, issues or browser developer tools. Restart the Node server after setup, then enter the password on `/admin`. Both the credential file and server `.env` are excluded from Git; the server serves only built frontend assets and does not serve these private files.

Administrator login sessions last up to eight hours. Logout or server restart invalidates them. Login uses a separate HttpOnly, SameSite=Strict cookie, Secure when served over HTTPS. Failed or repeated login attempts have visible errors; five attempts per IP are allowed per 15-minute window.

## Grant or extend access

1. Ask the visitor to open their roadmap and copy the displayed **Access ID**, such as `TF-012345ABCDEF`. This illustrative ID is not an actual credential.
2. Sign into `/admin` and locate that Access ID in the visitor list.
3. Grant a whole number of days from **1 to 365**. For an active manual grant, the same action extends its existing expiry; otherwise it starts from now. Total remaining manual access cannot exceed **365 days**.
4. Check the updated plan and expiry in the administrator view. The visitor's next server request uses that entitlement; the page polls every 30 seconds while visible and refreshes when focused.

The administrator sees Access IDs, first/last-seen dates, effective plan/source/expiry and usage counts. It does not expose profile answers, chat messages, OpenAI keys or private browser cookie values. An Access ID is a public lookup reference: knowing it does not sign someone into that browser or grant Plus.

Manual access expiry is checked by the server on every visitor API request. It is not just a client-side badge. A manual grant takes priority over demo access. Once it expires, an otherwise active demo can still provide Plus while public demo is enabled; turn public demo off when testing manual expiry or operating manual-only access.

## Revoke access and control Demo upgrade

Revoking an Access ID removes its manual expiry and clears the visitor's current demo flag. Task progress is preserved in the visitor's browser. If public demo remains on, that visitor can activate Demo upgrade again. Turn **public Demo upgrade off** when access should be controlled solely through manual grants.

The public demo setting is on initially. Turning it off is enforced by the server: it rejects `/api/demo-upgrade` and stops existing demo entitlements from providing Plus. Manual grants remain valid. Turning demo on permits visitors to activate it freely again, without payment. The visitor's **Return to Free for testing** action clears demo only; it cannot remove a manual grant.

## Storage and browser identity

Production Upstash Redis stores the public demo setting, manual/demo Plus expiries, identity-admission counters and up to 10,000 visitor records: Access ID, a digest of the private browser identity and timestamps. Admission data uses network digests, not raw IP addresses. Daily browser allowances, network/service-wide AI attempt reservations and shared security rate windows also live in Redis. No profiles, conversations, raw cookies or API keys are stored there. Atomic Lua changes preserve grants and limits under concurrent requests. Redis failure rejects storage-dependent actions rather than silently granting Plus or resetting counters.

Manual/demo access, the public demo setting, identity-creation limits and daily AI counters survive process restart while the same Redis database and signing secret are retained. Every production run requires `UPSTASH_REDIS_REST_URL` and a read/write `UPSTASH_REDIS_REST_TOKEN`; there is no file fallback. Keep Upstash eviction disabled. Development without Redis can use `server/data/access.json` and `usage.json`; local files and path overrides are development-only. `DATA_DIRECTORY` and `PERSISTENT_STORAGE_CONFIRMED` are not production settings anymore. Existing local grants are not uploaded automatically; review any needed migration privately.

The visitor's signed identity cookie lasts up to 365 days and is renewed on session use. Keeping the same cookie, access record and stable `SESSION_SECRET` preserves the identity link. Inactive records are eligible for cleanup after 30 days, measured from the latest of last seen, recorded manual expiry or recorded demo expiry; active manual/demo grants remain protected. Clearing cookies, changing browser/device or losing the signing secret can lose access. There is no visitor account, cross-device sync or recovery flow. The administrator can grant the new browser's Access ID separately when appropriate.

New browser identities have persisted rolling limits: 5 per network per 10 minutes, 40 per network per 24 hours, 100 service-wide per hour and 1,000 service-wide per 24 hours. Reopening the same recognized browser does not create a new record each time. At capacity, new identities receive a retryable error; the server does not evict active manual grants to admit them. Configurable admission and retention settings are listed in [the API guide](api.md#browser-identity-admission-and-cleanup).

Daily Mentor allowances and provider-attempt budgets are now persisted. Before OpenAI work, one browser question and all possible provider-attempt slots are reserved. Only the browser question may be refunded on a recorded failure; network and global attempt slots stay counted even on failure or restart. Changing a demo flag or restarting the service does not reset those counters. Defaults allow 100 attempt slots service-wide and 30 per network per UTC day; these limits can stop requests even while a visitor has personal allowance left.

Demo entitlement expiry is stored with its access record. Bounded chat still uses seven-day memory sessions and resets on restart. Administrator login sessions also remain in memory and reset on restart, while production login-attempt rate windows persist in Redis. Access grants and quota counters remain independent of those temporary sessions.

## Hosting and maintenance

Deploy the existing Node server with the frontend and `/api` on the same HTTPS origin. Add `ADMIN_PASSWORD_HASH` and a stable `SESSION_SECRET` of at least 32 characters to the host's private environment alongside the Redis and optional OpenAI settings. An explicit `APP_ORIGIN` takes priority; otherwise the server validates `RENDER_EXTERNAL_URL`. Use the host-provided `PORT`. Configure proxy trust only after verifying the host's forwarding chain; network limits must not trust arbitrary client headers.

Use an owner-configured Upstash database with eviction disabled and a private recovery plan; keep the same database and stable signing secret across deploys. No Render disk is required. Remove obsolete disk path/acknowledgement settings from Render and old import files. Follow [the Render Free/Upstash guide](render.md) for exact settings, free-service limitations and owner-controlled provisioning. Keep one Node instance for temporary chat/admin sessions; durable Redis changes coordinate atomically. Do not publish runtime data, `server/admin-access.txt` or `.env` to GitHub or expose them through static hosting. The local credential file is not needed on the public server; the administrator uses the private password corresponding to the configured hash.

There is no built-in password-rotation command. `setup:admin` deliberately preserves an existing hash and credential file. For a controlled rotation, stop the server, generate a new scrypt hash using the project's `hashAdminPassword` helper, replace only `ADMIN_PASSWORD_HASH` in the private local or hosting configuration, privately update the password record, and restart. Preserve `SESSION_SECRET` so existing browser identities continue to work. Do not clear `.env`, delete access data, or regenerate the signing secret merely to change an administrator password.

Run the automated checks without paid provider calls:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

They use isolated test credentials and mocked/offline AI transport. After a deployment, separately verify administrator login, a grant, an extension, revocation and the demo toggle for a test Access ID. None of those administrator operations sends a request to OpenAI or takes a payment.

# TeachForward

**We grow by helping others grow.**

TeachForward helps adults exploring a move into teaching in **Texas** turn their background into a personal roadmap. The MVP focuses on the **Skills** track and works without registration.

The app is a navigator. TEA and approved educator preparation programs determine certification eligibility. A completed checklist is self-reported progress, not a certificate or a promise of employment.

## Start on Windows

Install Node.js **22.12 or newer**. After cloning the repository, open PowerShell in its root folder, alongside `package.json`. Use `npm.cmd`, because Windows may block `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open **http://localhost:5173**. This single command runs the Vite frontend and Node.js API. The development API normally uses port **3001**; Vite forwards `/api` requests to it. Keep the terminal running and press **Ctrl+C** to stop both processes.

An OpenAI key is optional. The questionnaire, roadmap, saved task progress, official sources and Plus demo work without it. AI Mentor displays its unavailable state honestly.

If a port is already in use, stop the other TeachForward process before starting another. The default Vite proxy expects API port 3001; changing the development API port also requires updating `vite.config.js`.

## Walk through the product

1. Click **Get Started** and answer all four questions, or use **Explore a sample**. The sample uses exactly the same generator as your answers.
2. Read the personalized route, confirm the unknowns, and follow the highlighted next step. Different education and certification answers produce different pathways. Subject changes the practice and certificate questions; time changes the suggested weekly workload.
3. Check a task and refresh. Profile and task completion are saved in this browser’s `localStorage`.
4. Open **Skills studio** to see the Free boundary. When public demo access is enabled, **Demo upgrade** activates Plus without a card, charge, checkout or subscription. Otherwise share the **Access ID** shown on your roadmap with the administrator for manual access.
5. In Plus, use the weekly plan, subject exercises and downloadable progress summary. The Plus dialog lets demo users return to Free for testing. Administrator-granted access remains valid until its recorded expiry or revocation.
6. Ask AI Mentor a question when the server is connected. It receives your current profile, route, checked tasks and a bounded recent conversation with each question.

| Free | Plus |
| --- | --- |
| Full basic Texas roadmap and official sources | Everything in Free |
| Saved task progress and next action | Personalized weekly practice plan |
| One subject practice task in the roadmap | Additional practice exercises and note fields |
| Up to 3 successful Mentor questions per UTC day, when connected | Up to 20 successful Mentor questions per UTC day, when connected |
| | Downloadable JSON progress summary |

**$9.99/month is a proposed price being tested.** There is no payment integration or automatic subscription. The Node API checks Plus access using an anonymous signed browser cookie. The administrator can grant access for a limited number of days or enable the clearly labeled public demo.

## Administrator and manual Plus access

The separate password-protected administrator page is **http://127.0.0.1:5173/admin** in development, or **http://127.0.0.1:3001/admin** with the local production server. Visitors still use the site without registration.

Set up the administrator from PowerShell in the project folder. Git must be installed and the folder must be a Git checkout so the setup command can verify the secret-file ignore rules:

```powershell
npm.cmd run setup:admin
```

The command creates a random password in the Git-ignored local file `server/admin-access.txt`, adds a scrypt password hash to `server/.env`, and ensures a stable signing secret exists. These private files are generated locally and are not included in the repository. Setup preserves existing OpenAI and administrator settings, and prints no password or API key. Open the credential file privately in your editor, restart the Node server, then sign in at `/admin`. Never paste the file into chat or commit it.

Use the visitor's displayed Access ID to grant or extend Plus by **1–365 whole days**, with at most **365 days remaining** in total, or revoke access. You can also turn public Demo upgrade on or off. Access is checked on the server; the visitor page refreshes status every 30 seconds while visible and when focused. Manual grants and the demo setting persist in `server/data/access.json`. See [the administrator guide](docs/admin.md) for the workflow, storage, credential handling and hosting requirements.

## Connect AI Mentor locally

The Node server uses the official OpenAI SDK and Responses API. **One live check succeeded on November 14, 2026** during local verification: the provider and `/api/mentor` returned HTTP 200, and the real response appeared in AI Mentor. See [the live verification record](docs/live-verification.md). This dated check does not verify a new checkout's credentials or guarantee continuing access; each deployment needs its own verification. Starting the app does not automatically test the key or send a provider request.

Use an OpenAI account/API key only when you are ready to enable that external service. OpenAI API usage may incur provider charges. The project does not create an account or purchase credit.

The configuration file is **`server/.env`**, relative to the repository root. It is ignored by Git and is not included in a fresh checkout. Create it from the safe template only if it is missing; keep an existing file and its settings:

```powershell
if (-not (Test-Path -LiteralPath server/.env)) {
  Copy-Item -LiteralPath server/.env.example -Destination server/.env
}
```

Open **`server/.env` in your editor** and insert your key there yourself:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-luna
PORT=3001
OPENAI_MAX_RETRIES=1
```

Do not paste a key into chat, commit it, or put it into a `VITE_` variable. The browser never loads `server/.env`; `server/index.js` loads this exact server-side file using `dotenv`. `OPENAI_MODEL` is a server setting. The documented default, [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), supports text output and the Responses API. Its published standard text rates checked on November 14, 2026 are $0.10 per million input tokens and $0.50 per million output tokens. The configuration used in the dated local verification completed one successful live request; new keys, models and deployments require a separate check. The default uses `reasoning.effort: none`; changing the model requires checking that model's access and supported parameters. Restart the development command after changing environment configuration.

The official OpenAI Node SDK is called only in `server/app.js`, using the Responses API. Requests include the real question and server-generated context, rather than a fabricated fallback. The server enforces a 1,200-character question limit, a 16 KB JSON body limit, a per-IP limit of 10 Mentor attempts per minute, per-session daily allowances and one in-flight request per session. Answers are capped at 650 output tokens and 4,000 characters. The API has a 20-second total deadline, including at most one SDK retry for transient errors; `OPENAI_MAX_RETRIES` accepts only `0` or `1`. The frontend has a 25-second timeout. Failed, incomplete or oversized provider responses do not consume the local daily allowance.

The server retains at most three successful question/answer exchanges and 6,000 characters for the current anonymous conversation. It discards oldest complete exchanges to meet both bounds. A new conversation ID or any changed profile answer starts fresh history. The browser does not supply authoritative assistant history, certification facts or source links. Profile, roadmap and progress context are regenerated for every question; the verified dataset takes precedence over earlier chat text. Model-generated URLs are removed, and the interface displays only the reviewed server source links.

Missing configuration returns **503**. Provider errors return a generic **502**, and timeouts return **504**, without exposing the key or provider internals. Invalid inputs, quota limits and server connection problems have visible error states.

The recorded live check used one short real Mentor request through the interface with `OPENAI_MAX_RETRIES=0` and a guard against a second provider attempt. No second paid request was made. For a new setup, add your key locally, restart the server and make a short Mentor request when ready to use the paid API. Automated tests do not perform that check. A health check alone does not prove provider access.

## Production run

The public app needs a **Node.js server**. Deploying only the `dist` folder to static hosting will leave AI Mentor and Plus demo unavailable.

From the project folder:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd start
```

Open **http://localhost:3001**. The production command enables production mode and serves both the built React app and `/api` from one Node process. `dist` must exist before starting it. The server reads the host-provided `PORT`, with 3001 as its local default.

To deploy to a Node web service or your own Node host:

1. Upload or connect the source repository, including `package-lock.json`, `server`, `shared`, `src`, `public` and `index.html`. Exclude `.env`, `server/admin-access.txt`, `server/data/`, `node_modules`, test output and local secrets.
2. Set the build command to `npm ci --include=dev && npm run build`, and the start command to `npm start`. On a Windows host, use `npm.cmd` in those commands. The explicit `--include=dev` keeps Vite available during the build even when the host sets `NODE_ENV=production`.
3. Set `NODE_ENV=production` and `APP_ORIGIN` to the exact public HTTPS origin, for example `https://your-teachforward-domain.example`, without a trailing slash. The host usually supplies `PORT`.
4. Set a stable server-only `SESSION_SECRET` and `ADMIN_PASSWORD_HASH` in the host’s secret/environment settings. The administrator hash is generated by `npm.cmd run setup:admin`; the password stays private. To enable AI, set `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-6-luna` (or another verified model available to that key), and `OPENAI_MAX_RETRIES=1` there. Do not upload your local `.env`, credential file, or put these settings into frontend build variables. Restart or redeploy the Node service after changing them; local settings do not configure the host.
5. Set `TRUST_PROXY=1` only if the deployment is behind exactly one known trusted reverse proxy and the host’s forwarding setup requires it. Otherwise leave it unset. This affects client IP limiting and HTTPS handling.
6. Keep `/api` on the same origin as the frontend, use HTTPS, and configure the host’s health check to **`/api/health`**. It returns readiness and AI configuration status without secrets.
7. Mount a persistent writable volume at the project's `server/data` directory. `ACCESS_DATA_FILE` can select another JSON path **inside the project**; paths outside the project are rejected. Keep a private backup of that data and the stable signing secret. Without persistent storage, manual grants and the demo setting can be lost on redeploy.
8. After deployment, create a roadmap, refresh after checking a task, sign into `/admin`, grant and revoke access for its Access ID, test the demo setting, and verify the AI available/unavailable state. No publication or paid host has been configured by this project.

The deployment is a single-process MVP. Manual Plus expiry dates, browser-identity digests and the public demo setting persist in the JSON access store. Browser identity uses a signed HttpOnly, SameSite=Lax cookie lasting up to 365 days, renewed on API session use; retaining that cookie, the signing secret and the data file is necessary to preserve access. Clearing cookies, changing browser or losing the secret breaks that link, with no account-based recovery. Demo status, chat and usage counters remain in memory, expire after seven days, may be evicted at capacity and reset on server restart. Administrator login sessions last up to eight hours and also reset on restart. Multiple server instances do not share these sessions or coordinate JSON writes. Manual access does not process payments; real billing and durable shared quotas require a separate implementation.

## Data and privacy

- Profile answers and task completion stay in `localStorage` on the current browser and origin. They do not sync across devices. Clearing browser storage removes them. Editing profile answers starts a new roadmap and resets completion.
- Exercise notes are **this visit only**. They are not saved to `localStorage` and are not included in the progress download. Copy notes you want to keep before leaving or refreshing.
- The downloaded JSON contains profile choices, task completion, the weekly plan and source references. It is a personal progress summary, not an official document.
- Sending a Mentor question sends that question, four profile choices, the generated route, task completion, official source context, and up to three recent successful exchanges to the Node server and then OpenAI. Exercise notes are not sent. The history is stored only in the server's bounded anonymous session memory, up to 6,000 characters, and resets on a new conversation ID, changed profile, cookie loss or server restart. Leaving the roadmap or refreshing creates a new browser conversation ID; earlier history is not reused for that new conversation. Chat is not saved to localStorage.
- The API requests `store: false`. This is not a promise of zero provider retention; OpenAI’s account terms and data policies still apply. Do not include sensitive personal information in questions.
- Visitors have no registration or sign-in. The separate administrator page has password authentication and can view Access IDs, access dates, plan status and usage counts, but not profile answers, chat content or API secrets. Access metadata is stored in a local JSON file; no database service, analytics, payment processor or email service is connected.

## Official requirements and source updates

The requirement dataset was manually checked against official TEA pages on **November 14, 2026**. Each source has a URL and verification date in `shared/roadmap.js` and is visible in **Official sources**. See [the source review notes](docs/sources.md).

The roadmap distinguishes degree preparation, alternative/post-baccalaureate preparation, international degree clarification, existing Texas certificates, out-of-state credentials and foreign/uncertain credentials. It does not infer exact tests from a broad subject preference. Unknown certificate type/status, degree equivalency, grade band, admission, fees and timing remain questions for TEA or the preparation program. Skills exercises are explicitly TeachForward suggestions rather than TEA requirements.

To refresh the dataset, review the linked pages, update the affected summaries and logic, change the verification date only after checking the sources, and rerun tests. The app does not automatically monitor TEA changes.

## Tests and browser checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Unit/API tests use Node’s built-in test runner. They cover questionnaire validation, pathway differences, all 300 supported profile combinations, source metadata, server-side paywall checks, administrator authentication and access rules, JSON access-store behavior, real-input AI context construction, bounded conversation history, missing configuration, provider failures, timeout behavior and request limits. Provider calls are replaced with injected test clients or offline SDK transport: these tests do not send requests to OpenAI or require a key.

The Playwright browser suite uses installed **Microsoft Edge** on Windows and an isolated production server on port **3002**. It checks user flows, persistence, paywall behavior, administrator controls and responsive layouts without paid provider calls. Close any other process occupying that test port before running it. Browser output is ignored by Git.

## Prepare a public GitHub repository

`.gitignore` excludes server `.env` files, the private `server/admin-access.txt`, mutable `server/data/`, other local environment files, dependencies, build output, logs and browser-test artifacts. It explicitly allows safe `.env.example` templates. `server/.env.example` contains no key or password.

Before publishing or staging new files, inspect the file list with your Git client. From the repository root in PowerShell, verify that local secret files and access data are ignored:

```powershell
git check-ignore server/.env
git check-ignore server/admin-access.txt server/data/access.json
git status --short
```

Stage source files and the lockfile, then inspect the staged file names with `git diff --cached --name-only`. Ensure no real `.env`, administrator credential file or runtime access data is staged. `.gitignore` does not remove a secret from existing Git history; if you ever committed one, revoke it and clean the history before publishing. Never paste environment-file contents into logs or issue reports.

The project does not create a GitHub remote, push a repository or deploy publicly. You choose the repository and hosting account when ready.

## Project map

```text
src/                  React interface, styles and browser progress storage
shared/roadmap.js     Validated profiles, deterministic routes and TEA sources
server/app.js         Node API, anonymous demo sessions, limits and OpenAI SDK
server/index.js       Environment loading and server startup
server/admin.js       Administrator password hashing and verification
server/access-store.js Durable manual-access metadata and demo settings
scripts/setup-admin.mjs Safe local administrator setup
server/.env.example  Safe local configuration template
tests/                Unit/API and browser tests
docs/sources.md       Requirements verification and update notes
docs/admin.md         Administrator workflow and hosting storage
vite.config.js        React build and development API proxy
```

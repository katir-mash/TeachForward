# Live AI Mentor verification

On **November 14, 2026**, one short live request verified the existing TeachForward server and AI Mentor interface on the current workstation.

| Check | Observed result |
| --- | --- |
| Provider integration | Official OpenAI Node SDK, Responses API |
| Model | `gpt-6-luna` |
| Real provider attempts | Exactly **1**; `OPENAI_MAX_RETRIES=0`, with a guard blocking any second attempt |
| Provider response | HTTP **200** |
| TeachForward endpoint | `POST /api/mentor` returned HTTP **200** |
| Interface | The real answer appeared in AI Mentor |
| Profile and progress | Bachelor's degree, no teaching certificate, mathematics interest; the preparation-program shortlist task was already checked |
| Context-aware next action | The answer suggested choosing a mathematics grade band, matching the next unchecked step |

The observed answer used the current profile and progress. It did not invent an exam code or promise certification. The check did not read or expose a key in chat, terminal output, or application logs.

This was one dated smoke check. No second paid request was made, and other models were not tested. It does not establish continuing provider availability, future quota, or availability to another key. A fresh deployment must configure its own server secrets and verify its own Mentor request. Starting the app makes no automatic provider request; `/api/health` reports configuration, not successful generation.

Local QA evidence is kept under the Git-ignored `tests/artifacts/` directory, including `live-provider-summary.json`. Those transient artifacts and the local `server/.env` are not intended for the public repository.

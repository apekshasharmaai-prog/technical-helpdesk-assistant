# React Helpdesk Workbench

The mint/teal support workspace runs independently of any portfolio or Replit
monorepo. The original repository's Streamlit app and CLI remain available.

## Requirements and setup

- Node.js 20.19+ and pnpm 10
- Python 3.11+ and the dependencies below
- OpenAI API access configured securely through `OPENAI_API_KEY` (never commit it)

From this `web` directory:

```sh
python3 -m pip install -r python/requirements.txt
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open http://localhost:3001. `PORT` changes the server port; `PYTHON_BIN` chooses
the Python executable. Configure the key in the server's environment before
starting. `OPENAI_MODEL` optionally overrides the default `gpt-5.4-mini`.
Replit's managed OpenAI key and base URL are also supported when both are set.
No environment file, key or secret is included in this repository.

For development, run `pnpm api` and `pnpm dev` in separate terminals. Open
http://localhost:5173; Vite proxies `/api` to the API on port 3001.
Production serves the built UI and API together at the domain root; no CORS or
portfolio service is required.

## Behavior and safety

- Real Python/LangChain workflow: triage, category analysis, resolution,
  response draft. Four model calls per processed ticket.
- Add tickets, process selected tickets sequentially, retry failures, filter,
  inspect analysis and edit/copy replies.
- Fictional samples start unprocessed. No simulated AI results.
- Tickets/results/drafts persist only in browser local storage. Clearing browser
  data removes them; they are not shared across browsers.
- Ticket content is sent to the model provider only when you select Process.
- Recommendations and drafts only: no messages, refunds or account actions.
- Server validates inputs/results, enforces two concurrent jobs, limits processing
  to 40 requests/IP/hour and 200/server/hour, and bounds subprocess time/output.
  Quotas are process-local and reset on restart. Behind a proxy, the default
  untrusted-proxy setting conservatively groups requests by the proxy IP.

This is an educational application without sign-in or organization isolation.
Do not enter sensitive customer data or expose an unprotected, billable endpoint
publicly. Real customer use requires authentication, access controls, retention
policies, shared rate limits and provider budget controls.

## Verification

```sh
pnpm build
pnpm test
cd python
python3 -m unittest -v test_workflow
```

API tests use injected workflow fixtures; Python tests stub model calls. Neither
test suite consumes AI credits. The `python/` workflow is isolated from the
original Streamlit workflow to keep existing commands compatible.

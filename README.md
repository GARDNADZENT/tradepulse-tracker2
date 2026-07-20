# TradersPulse

A capital-first trading analytics dashboard for **Deriv Options** traders. TradersPulse helps you lock a trading plan (the *Journey*), then compares that locked plan against your **real Deriv account balance** day by day — answering one question: *"Am I ahead of or behind my plan today?"*

- **Locked Journey** — set your starting balance, daily growth target, and journey duration. It is locked and becomes your single trading plan.
- **Master Schedule — Live** — the locked plan overlaid with your real Deriv account progress for every journey day (Expected Start, Expected End, Daily Profit, Required %, Actual Balance, Difference, Status).
- **Today's Target** — a focused summary of today's Master Schedule row: expected starting/ending balance, live balance, remaining profit, progress, and status.
- **Contract Performance & Account** — lifetime and today-only trading statistics sourced from the selected Deriv account.
- **Real / Demo switching** — switch accounts without losing your locked journey; only live data updates.

---

## How it works

```
Locked Journey  ──▶  Generate Master Schedule (once)  ──▶  Determine Current Journey Day
                                                              │
                                                              ▼
                                                        Today's Row
                                                       ┌──────────┴─────────┐
                                                       ▼                    ▼
                                              Today's Target        Master Schedule — Live
                                                       │
                                                       ▼
                                            Merge Live Deriv Balance
```

- The **Master Schedule is generated once** from the locked journey (initial balance × (1 + daily growth) per day).
- The **current journey day** is derived from `Today − Locked Start Date`.
- **Today's Target** is not calculated independently — it simply displays today's row from the Master Schedule.
- Live data (balance, statement, portfolio, profit table) comes from the **selected Deriv account**.
- Deriv's `balance`, `statement`, `portfolio`, and `profit_table` are **WebSocket-only** endpoints, so the server obtains a one-time WebSocket URL via the OTP REST endpoint and streams the data over that connection.

---

## Tech stack

- **Backend:** Node.js + Express, better-sqlite3 (journey storage), Deriv REST + WebSocket API.
- **Frontend:** Single-page app in `public/index.html` (vanilla JS, Tailwind-style utility classes, Lucide icons).
- **Auth:** Deriv OAuth 2.0 (Authorization Code + PKCE), scopes `trade` and `account_manage`.

---

## Prerequisites

- Node.js 18+
- A [Deriv](https://deriv.com) account
- A Deriv OAuth **App ID** (register at `https://developers.deriv.com`)

---

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/GARDNADZENT/tradepulse-tracker.git
   cd tradepulse-tracker
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file (copy from `.env.example`):

   ```bash
   cp .env.example .env
   ```

   | Variable               | Description                                                        |
   | ---------------------- | ------------------------------------------------------------------ |
   | `DERIV_APP_ID`         | Your Deriv OAuth App ID.                                           |
   | `DERIV_REDIRECT_URI`   | OAuth redirect URI (must match the Deriv app config). Example: `https://your-domain/callback` |
   | `SESSION_SECRET`       | Random string used to sign session cookies.                        |
   | `PORT`                 | Port the server listens on (default `8000`).                      |

   > The Supabase variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`) are optional and only needed if you integrate Supabase auth.

4. Start the server:

   ```bash
   npm start
   ```

   The app runs at `http://localhost:8000`.

---

## Deriv OAuth configuration

1. Create an app at the [Deriv API dashboard](https://developers.deriv.com).
2. Set the **OAuth redirect URI** to `<DERIV_REDIRECT_URI>` (e.g. `https://your-domain/callback`).
3. Ensure the app requests the `trade` and `account_manage` scopes (handled automatically by the app).

---

## Usage

1. Open the app and click **Login with Deriv**.
2. Authorize the app on Deriv.
3. After login, the app defaults to your **Real** account (falls back to Demo if no Real account exists).
4. **Lock your Journey**: set Starting Balance, Daily Target %, Journey Duration, and Start Date.
5. The **Master Schedule — Live** and **Today's Target** populate automatically from your locked plan and live Deriv balance.
6. Use the account switcher to toggle between Real and Demo — your journey stays locked; only live data refreshes.

---

## Project structure

```
traderspulse/
├── server/
│   ├── index.js          # Express entry point
│   ├── oauth.js          # OAuth callback + login routes
│   ├── oauth-helper.js   # PKCE / token exchange helpers
│   ├── deriv.js          # Deriv REST + WebSocket data layer
│   ├── journey.js        # Journey lock + schedule storage (SQLite)
│   ├── routes.js         # /api/balance, /statement, /portfolio, /profit-table, /oauth/me
│   ├── session.js        # Session token access
│   ├── db.js             # better-sqlite3 connection
│   └── memory-store.js   # In-memory session store
├── public/
│   ├── index.html        # SPA dashboard
│   └── statics/          # static assets
├── data/                 # SQLite database (gitignored)
├── .env.example
└── package.json
```

---

## API endpoints

| Method | Path                   | Description                                   |
| ------ | ---------------------- | --------------------------------------------- |
| GET    | `/oauth/login`         | Begins Deriv OAuth (redirects to Deriv).      |
| GET    | `/oauth/callback`      | OAuth callback (exchanges code, sets session).|
| GET    | `/api/oauth/me`        | Returns accounts + current account.           |
| GET    | `/api/balance`         | Live balance for an account (`?account_id=`). |
| GET    | `/api/statement`       | Trading statement (`?account_id=`).           |
| GET    | `/api/portfolio`       | Open positions (`?account_id=`).              |
| GET    | `/api/profit-table`    | Profit/loss summary (`?account_id=`).         |
| GET    | `/api/journey`         | Get locked journey + generated schedule.      |
| POST   | `/api/journey`         | Lock / create a journey.                       |
| DELETE | `/api/journey`         | Reset (delete) the locked journey.            |
| POST   | `/api/logout`          | End the session.                              |

---

## Notes & limitations

- Sessions are stored **in memory** by default; a server restart logs everyone out. For production, wire `memory-store.js` to a persistent store (e.g. Redis) or enable SQLite/Redis session storage.
- The **Master Schedule is the single source of truth** for plan values; the selected Deriv account is the single source of truth for live balance/history. No placeholder values are used.
- Never commit `.env` or `node_modules/` — they are excluded via `.gitignore`.

---

## License

See repository for license details.

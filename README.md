# Vehic-le · גלגל לוחית

Roll a random Israeli license plate and discover which real vehicle it belongs to —
then see how *rare* that find is. Each roll pulls a random record from the public
[data.gov.il vehicle registry](https://data.gov.il) and scores it on manufacturer,
model, year, color, fuel type, and patterns in the plate number itself (palindromes,
primes, perfect squares, sequences, and more), producing a 0+ score and a D→S tier.

The roll, the dataset lookup, and the scoring all happen **on the server**. The browser
only plays the slot-machine reveal animation — it can't pick its own plate or fake a
score.

## How it works

```
public/      static client — animation only, calls GET /api/roll
server/
  index.js   Express app: serves public/, exposes GET /api/roll
  dataset.js data.gov.il client + cached row count (refreshed every 6h)
  scoring.js all scoring tables and logic
```

On each `GET /api/roll` the server picks a random row from the dataset, fetches that
vehicle, scores it, and returns a finished payload (`plate`, `fields`, `platePerks`,
`score`, `tier`). The dataset's total row count is cached and refreshed every 6 hours
rather than fetched on every roll.

## Running locally

Requires **Node.js 18+** (for built-in `fetch`).

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

The server listens on `PORT` (default `3000`):

```bash
PORT=8080 npm start
```

## Deploying

It's a standard single-process Node web service with one dependency (Express) and no
database of its own — the only external call is to the public data.gov.il API. Deploy it
anywhere that runs Node 18+:

1. Copy the project to the server (or `git clone` it).
2. `npm install --omit=dev` to install Express.
3. Set `PORT` to whatever your host expects (many platforms inject this automatically).
4. Start it with `npm start`, ideally under a process manager so it restarts on crash/reboot:

   ```bash
   # with pm2
   pm2 start server/index.js --name vehic-le

   # or with systemd / your platform's process runner, running: node server/index.js
   ```

5. Put it behind a reverse proxy (nginx, Caddy, or your platform's router) to terminate
   HTTPS and forward to the app's `PORT`.

**PaaS (Render / Railway / Fly / etc.):** point the platform at this repo, set the build
command to `npm install` and the start command to `npm start`. These platforms set `PORT`
for you, which the server already honors. No other configuration is needed.

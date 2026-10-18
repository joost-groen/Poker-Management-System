# Poker Bank

Mobile-first bookkeeping for home poker games: buy-ins, rebuys, cash-outs, end-of-night settlement and an all-time ranking. One server holds the data; the web app (and later iOS/Android apps) talk to it over a small JSON API.

## The rules it enforces

- Everyone starts with one **buy-in** of `x` €. The buy-in is fixed per game.
- **Rebuy**: when your stack is below `x`, buy in again for `x`. Your debt grows by `x` (2x, 3x, …).
- **Cash out**: hand back `x` in chips to lower your debt by `x`. Only possible while you still have debt — profit can't leave the table before the end. At debt €0 you play on pure profit.
- **Settle**: count every final stack. They must add up to what is on the table (buy-ins − cash-outs). Result = final stack − debt; the app lists the fewest payments that square everyone.
- **Ranking**: sum of results over all closed games, filterable per year.
- **Player page**: stats plus a balance chart: the running total of a player's results, one point per closed game. Drag across it (or use the arrow keys) to see the date, result and balance of each game.

## Roles and languages

- **Group** (`APP_PIN`): everything needed on a game night — players, games, rebuys, cash-outs, undo, settling.
- **Admin** (`ADMIN_PIN`, unlocked under Settings): rename, delete and restore players; change a game's date, delete single log entries or remove players from a live game, reopen and delete games. Players who have played are archived instead of deleted, so past games still add up. Admin mode ends when the app is closed. Wrong codes are rate-limited (10 per 15 minutes per IP).
- **Desktop and TV**: from 1024 px wide the app switches to a sidebar layout with wider, two-column screens. **TV mode** (`#/tv`, in the sidebar or the game's header) is a full-screen view of the current game for a TV or second screen: debts, total on the table, recent actions, a chart of chips on the table over time and the all-time top 5. It refreshes by itself, keeps the screen awake and hides the cursor. `#/tv/<id>` pins one game.
- **Language**: English and German (Settings), defaulting to the device language. Server errors carry a `code` that the app translates; all texts live in [web/src/i18n.ts](web/src/i18n.ts).

## Play: online poker

A separate section (**Play** in the tab bar, `#/online`) for No-Limit Texas Hold'em. It has its own look, navigation, accounts, database file and stats, and never reads or writes Poker Bank's games, players or ranking.

- **Practice**: play against bots, with 2 to 6 players at the table and stacks of 50, 100 or 200 big blinds. You only get the game, no hints. There are three levels: **Beginner** (loose and passive), **Regular** (solid, tight-aggressive) and **Shark** (plays by position, sizes bets by equity, semi-bluffs and bluffs). Bot games run entirely in the browser; their record (hands and result in big blinds per level) is stored on the device only.
- **Learn**: the same games, plus a coach. On every decision it shows:
  - your win chance (Monte Carlo equity against the hands still in) and the pot odds;
  - your outs, with the rule of 2 and 4;
  - your position and your starting hand's group;
  - a suggested action, with the reason for it.

  After each action you get feedback (good, okay or mistake, with the numbers behind it). After each hand there is a review. Recurring leaks, such as calling without the odds or folding when checking is free, are collected on your profile.
- **At the table**: every step is played out on screen: bots take a moment to think (longer for a raise than a fold), bets slide in and are swept into the pot, each street is dealt after a short pause, an all-in turns the hands up and runs the board out card by card, and the pot goes to the winner. Live tables are replayed the same way, and the server waits for the replay before dealing on. Table sounds (cards, chips, check, fold, your turn, a win) are synthesised in the browser; the speaker button mutes them on that device. Poker terms (Flop, River, High card, Full house …) stay English in German too.
- **Friends**: live tables for 2 to 9 players.
  - **Joining**: the host picks blinds, the buy-in and the number of seats. Friends join with the 6-character code or the shared link `#/online/t/CODE`.
  - **During play**: everyone acts from their own phone, with a 30-second clock; two timeouts in a row sit you out. Rebuy (one more buy-in, between hands, while your stack is below the buy-in), sit out or stand up at any time.
  - **Ending**: when the host ends the table, everyone is cashed out. The result screen shows who pays whom.
  - **Table types**: **Cash** tables are in euro and count in the online leaderboard (net, tables, hands, VPIP, weekly). **Fun** tables use play chips and are never counted.
  - **No money moves through the app**: like Poker Bank, it only keeps the books.
- **Accounts**: username, password (scrypt-hashed) and an emoji avatar. Accounts sit behind the same group code as the rest of the API; the session travels in an `X-Online-Session` header. Failed logins are rate-limited (10 per 15 minutes per IP).
- **Separate data**: everything is stored in `online.db`, next to `poker.db` (`/data/online.db` in Docker, inside the same volume). The server refuses to start if `ONLINE_DB_FILE` points at Poker Bank's database. Backups go to the same folder as `online-YYYY-MM-DD.db` and are pruned separately. Live tables run in memory and save stacks between hands, so a restart voids at most the hand that was running.
- **Live updates**: each player gets their own Server-Sent Events stream with only their own hole cards (`GET /api/online/tables/:code/stream`). There is no extra dependency, and it works through Traefik.

## Run

Requires Node 24+ (uses the built-in `node:sqlite` and native TypeScript support, so the server has no build step).

```bash
npm install
npm run dev:server   # API on :3000, data in data/poker.db
npm run dev:web      # Vite on :5173, proxies /api to :3000
```

Production without Docker:

```bash
npm run build && npm start
```

## Deploy

Runs on any small Linux server with Docker (e.g. a Hetzner CX22, ~€4/month). It plugs into a [Traefik](https://traefik.io) instance already running on the server, which routes the domain to the app and handles HTTPS.

1. **Server**: create an Ubuntu VPS, then on it:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
2. **Traefik**: needs a Docker network the app can join (default `traefik`), an HTTPS entrypoint (default `websecure`) and a certificate resolver (default `letsencrypt`). If yours use other names, set `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT` and `TRAEFIK_CERTRESOLVER` in `.env`. Redirecting HTTP to HTTPS is left to Traefik's own config.
3. **Domain**: point an A record (e.g. `poker.example.com`) at the server's IP.
4. **Code**: copy the project over (or `git clone` it from your own remote):
   ```bash
   rsync -av --exclude node_modules --exclude dist --exclude data --exclude ios ./ root@SERVER_IP:/opt/poker-bank/
   ```
5. **Config and start**, on the server in `/opt/poker-bank`:
   ```bash
   cp .env.example .env    # set DOMAIN, APP_PIN and ADMIN_PIN
   docker compose up -d --build
   ```
6. Open `https://poker.example.com` on an iPhone → Share → **Add to Home Screen**. It opens full-screen, works like an app and starts even on bad Wi-Fi.

Update later: copy the code again, then `docker compose up -d --build`. Home-screen apps pick up the new version on their next launch.

**Backups**: the server writes a copy of the database every day to `/data/backups` inside the `poker-data` volume and keeps the last 30. Copy them off the machine now and then (or enable your provider's snapshots):

```bash
docker compose cp poker-bank:/data/backups ./backups
```

| Env | Default | |
| --- | --- | --- |
| `DOMAIN` | required in compose | Public hostname Traefik routes to the app. |
| `TRAEFIK_NETWORK` / `TRAEFIK_ENTRYPOINT` / `TRAEFIK_CERTRESOLVER` | `traefik` / `websecure` / `letsencrypt` | Names from your Traefik setup. |
| `APP_PIN` | required in compose | Shared access code for your group, sent as `Authorization: Bearer <code>`. |
| `ADMIN_PIN` | empty (admin off) | Admin code, sent the same way; also grants group access. Use a different, longer code. |
| `PORT` | `3000` | |
| `DB_FILE` | `data/poker.db` (`/data/poker.db` in Docker) | SQLite file. |
| `BACKUP_DIR` / `BACKUP_KEEP` | `<db dir>/backups` / `30` | Daily backups; `BACKUP_KEEP=0` turns them off. |
| `ONLINE_DB_FILE` | `online.db` next to `DB_FILE` | Database of the online section (accounts, tables, hands). Must differ from `DB_FILE`. |
| `ONLINE_ACTION_MS` / `ONLINE_NEXT_HAND_MS` | `30000` / `4000` | Time per decision at live tables, and the pause between hands. |
| `CORS_ORIGIN` | `*` | Origins allowed to call the API. |

## API

All amounts are integer cents. Types: [shared/types.ts](shared/types.ts). Errors are `{ error, code, params }`. 🔒 = admin PIN.

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/meta` | – (no auth) → `{ auth, admin }` |
| GET | `/api/session` | – → `{ role }` |
| GET / POST | `/api/players` | `{ name }` (🔒 `?all=1` includes archived) |
| GET | `/api/players/:id` | – |
| PATCH / DELETE 🔒 | `/api/players/:id` | `{ name }` / – → `{ deleted, archived }` |
| POST 🔒 | `/api/players/:id/restore` | – |
| GET / POST | `/api/games` | `{ buyIn, playerIds[] }` |
| GET | `/api/games/:id` | – |
| PATCH / DELETE 🔒 | `/api/games/:id` | `{ date: "YYYY-MM-DD" }` / – |
| POST | `/api/games/:id/rebuy` · `/cashout` · `/join` | `{ playerId }` |
| POST | `/api/games/:id/undo` | – (last rebuy / cash-out / late join) |
| POST | `/api/games/:id/close` | `{ stacks: [{ playerId, stack }] }` |
| POST 🔒 | `/api/games/:id/reopen` | – |
| GET | `/api/games/:id/log` | – → every entry of the game |
| DELETE 🔒 | `/api/games/:id/log/:entryId` · `/api/games/:id/players/:playerId` | – |
| GET | `/api/ranking?year=2026` | – |

Online section, under `/api/online` (types: [shared/online.ts](shared/online.ts); amounts are cents at cash tables, chips at fun tables). Everything except register and login needs `X-Online-Session: <token>`.

| Method | Path | Body |
| --- | --- | --- |
| POST | `/register` · `/login` | `{ username, password, avatar }` · `{ username, password }` → `{ token, account }` |
| POST | `/logout` | – |
| GET / PATCH | `/me` | – / `{ avatar }` |
| GET / POST | `/tables` | `{ name, mode: "cash" \| "fun", sb, bb, buyIn, maxSeats }` |
| GET | `/tables/:code` · `/tables/:code/view` | – → summary (+ results once closed) · your live view |
| GET | `/tables/:code/stream` | – → Server-Sent Events, one live view per change |
| POST | `/tables/:code/join` | `{ seat? }` |
| POST | `/tables/:code/action` | `{ type: "fold" \| "check" \| "call" \| "raise", to? }` |
| POST | `/tables/:code/sit` | `{ out: boolean }` |
| POST | `/tables/:code/start` · `/rebuy` · `/leave` · `/close` | – (start and close: host only) |
| GET | `/stats` · `/stats/:accountId` | – → leaderboard · one player's cash tables |

## Native iPhone app (optional)

Not needed: the home-screen web app covers it. Kept for later (push notifications, App Store). The iOS app is the same web client wrapped with [Capacitor](https://capacitorjs.com) (`ios/`). On first launch it asks for the server address and access code, so one build works with any server.

```bash
npm run ios          # build the web client, copy it into ios/, open Xcode
```

To hand it to your group via TestFlight (needs an Apple Developer account):

1. Change `appId` in `capacitor.config.ts` to an id you own, then `npx cap sync ios`.
2. In Xcode: App target → Signing & Capabilities → pick your team.
3. Product → Archive → Distribute App → TestFlight & App Store, then invite the group in App Store Connect.

`VITE_API_URL=https://your-server npm run build` bakes a server address in and skips that part of the Connect screen. Anyone on Android uses the website ("Add to Home Screen").

## Layout

```
server/src         Express API + SQLite (games.ts holds the game rules)
server/src/online  Online poker: accounts, live tables, stream, stats (own online.db)
shared             API types used by server and clients
shared/poker       Hold'em engine shared by server and browser: evaluator, betting rules, equity, bots, coach
web/src            React client (pages/, components/Info.tsx for the "i" tooltips)
web/src/online     The Play section, loaded on first visit
ios          Capacitor iOS project (generated; web assets copied in by `cap sync`)
```

`npm test` runs the rule tests (including the poker engine, bots and online tables), `npm run typecheck` checks everything.

# Titan Up

Self-hosted retrospectives for your team. One small server, one data file, no
accounts to manage.

- **Retros** in five steps: brainstorm privately, group similar notes, dot-vote,
  discuss in vote order, wrap up. Built-in formats: Start/Stop/Continue,
  Went well/To improve/Ideas, Mad/Sad/Glad, the 4 Ls, Sailboat.
- **Action items** with an owner and a done box. Open ones come back in a
  Review step at the start of the team's next retro, and live on the team page.
- **Health checks**: everyone rates a set of areas from 1 to 5, results appear
  on a radar chart next to the previous check, and the team page charts the
  trend.
- **Live for everyone**: notes, groups, votes, the timer and the current topic
  update in every browser at once.
- **No sign-up**: people open the link, type a name, and they are in. The
  browser remembers them. Notes and ratings are always anonymous.

## Run it on a VM with Docker

Copy this folder to the VM (or `git clone` it), then:

```sh
docker compose up -d --build
```

Titan Up is now on `http://<vm-address>:8080`. To use another port, set
`TITAN_UP_PORT` first, for example `TITAN_UP_PORT=80 docker compose up -d --build`.

- **Data** is one SQLite database in the `titan-up-data` Docker volume. It
  survives restarts, rebuilds and upgrades.
- **Update**: replace the files, then run `docker compose up -d --build` again.
- **Back up**: `docker compose cp titan-up:/data ./backup` copies the database
  out of the running container. Copy all three `titan-up.db*` files together.
- **Logs**: `docker compose logs -f`.
- **Stop**: `docker compose down` (add `-v` only if you want to delete all data).

## Run it without Docker

Needs Node.js 22.13 or newer. Nothing to compile.

```sh
npm ci --omit=dev
npm start
```

It listens on port 3000 and keeps its database in `./data`. Settings, all
optional environment variables:

| Variable   | Default   | What it does                              |
| ---------- | --------- | ----------------------------------------- |
| `PORT`     | `3000`    | Port to listen on                         |
| `HOST`     | `0.0.0.0` | Address to bind to                        |
| `DATA_DIR` | `./data`  | Folder that holds the `titan-up.db` file  |

## Who can do what

Titan Up is built for a trusted internal network. There are no passwords:

- Anyone who can reach the server can see every team and join any retro.
- Whoever starts a retro or health check is its facilitator. Only the
  facilitator moves between steps, runs the timer and picks the topic. They can
  hand the role to someone else, and anyone can take it over if the facilitator
  disconnects.
- People can edit and delete only their own notes. Nobody, including the
  facilitator, can see who wrote a note or gave a rating.
- Only the person who started a retro or health check, or its current
  facilitator, can delete it.
- A person is remembered by their browser. Clearing site data, or switching
  browser or device, makes them a new person (their old notes stay, but can no
  longer be edited by them).

Do not expose it to the public internet as it is. If it ever needs to be
reachable from outside, put it behind a reverse proxy that adds HTTPS and
sign-in (the proxy must pass WebSocket upgrades through on `/ws`).

## Development

```sh
npm install
npm run dev     # restarts the server when files in server/ change
npm test        # runs a full retro and health check against a throwaway database
```

The browser code in `public/` has no build step: edit a file and reload.

```
server/index.js      HTTP API, static files, WebSocket rooms
server/retro.js      retro rules: what each person may see and do in each step
server/radar.js      health check rules and results
server/actions.js    action items
server/templates.js  retro formats and health check areas (edit to add your own)
server/db.js         SQLite schema
public/js/           the single-page app (Preact, loaded without a bundler)
```

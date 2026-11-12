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

## Install on Windows

Works on Windows 10, Windows 11 and Windows Server 2016 or newer. During the
install the computer needs to reach one site, `nodejs.org`. Everything else
comes with the download.

1. Get the files onto the computer: `git clone https://github.com/giuseprinaldi/Titan-Up.git`,
   or use **Code > Download ZIP** on GitHub and unzip it.
2. Double-click **`install-windows.cmd`** and approve the administrator prompt.

When it finishes it shows the address to give your teammates, for example
`http://vm-name:8080`. From then on Titan Up starts by itself whenever Windows
starts, with nobody logged in, and restarts within a few seconds if it ever
stops.

What the installer does, so there are no surprises:

- Copies the app to `C:\Program Files\Titan Up`. The folder you downloaded is
  only needed for the install; you can delete it afterwards.
- Downloads a private copy of Node.js into that folder (checked against the
  published checksum). Nothing is installed system-wide.
- Keeps the database and log in `C:\ProgramData\Titan Up`.
- Registers a scheduled task named "Titan Up" that runs as the built-in
  low-privilege "Local Service" account.
- Adds a Windows Firewall rule named "Titan Up" for the port.

Options, from a command prompt in the downloaded folder:

| Command                                    | What it does                                                          |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `install-windows.cmd -Port 80`             | Serve on another port (default 8080)                                  |
| `install-windows.cmd -DataDir D:\titan-up` | Keep the database and log somewhere else                              |
| `install-windows.cmd -InstallDir D:\Apps\Titan Up` | Copy the app somewhere other than Program Files              |
| `install-windows.cmd -CurrentUser`         | No administrator rights: see below                                    |
| `install-windows.cmd -Uninstall`           | Remove the task, firewall rule and Program Files copy (database kept) |

- **Update**: download the new version (`git pull`, or a fresh ZIP) and run
  its `install-windows.cmd` with the same options. The database is untouched.
- **Back up**: copy `C:\ProgramData\Titan Up` (all three `titan-up.db*` files
  together).
- **Stop or start**: Task Scheduler, task "Titan Up". Stopping the task stops
  the server.
- **If something goes wrong**: the install writes `deploy\install.log` in the
  downloaded folder, and the running server writes `titan-up.log` next to the
  database.

**Without administrator rights**, `install-windows.cmd -CurrentUser` copies
nothing: Titan Up runs from the downloaded folder as you, starts when you log
on, and only runs while you are logged on (a disconnected Remote Desktop
session counts). Its database and log are in the `data` folder there.
Teammates can only reach it if Windows Firewall allows the port, and adding
that rule needs an administrator. Remove it with
`install-windows.cmd -CurrentUser -Uninstall`.
- If your company blocks PowerShell scripts by policy, the installer cannot
  run; ask IT to allow it, or use "Run it by hand" below.

## Run it by hand

For trying it out, or for developing. Needs Node.js 22.13 or newer on the
computer. Nothing to compile or install: the packages it uses are in
`node_modules`, as part of the download.

```sh
npm start
```

It listens on port 3000 and keeps its database in `./data`. Settings, all
optional, as environment variables or as options after `server/index.js`:

| Variable   | Option        | Default   | What it does                             |
| ---------- | ------------- | --------- | ---------------------------------------- |
| `PORT`     | `--port=`     | `3000`    | Port to listen on                        |
| `HOST`     | `--host=`     | `0.0.0.0` | Address to bind to                       |
| `DATA_DIR` | `--data-dir=` | `./data`  | Folder that holds the `titan-up.db` file |

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
npm run dev     # restarts the server when files in server/ change
npm test        # runs a full retro and health check against a throwaway database
```

The browser code in `public/` has no build step: edit a file and reload.

`node_modules` is committed on purpose, so the installer works on computers
that cannot reach the npm registry. After changing a dependency, run
`npm ci --omit=dev` and commit the result; `npm test` fails if the folder and
`package-lock.json` disagree.

```
server/index.js      HTTP API, static files, WebSocket rooms
server/retro.js      retro rules: what each person may see and do in each step
server/radar.js      health check rules and results
server/actions.js    action items
server/templates.js  retro formats and health check areas (edit to add your own)
server/db.js         SQLite schema
public/js/           the single-page app (Preact, loaded without a bundler)
install-windows.cmd  double-click installer (runs deploy/install.ps1)
deploy/install.ps1   copies the app into place, sets up Node.js and the scheduled task
node_modules/        the packages the server and pages use (committed, see above)
deploy/run.ps1       what the scheduled task runs: keeps the server running and writes the log
```

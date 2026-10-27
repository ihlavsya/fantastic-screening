# Job Tracker — Design Decisions

See `PRODUCT.md` for what it does. This file covers how.

## Versions

- **v0 (now)**: djinni → code prefilter → applicants < 50 → Telegram ping. No Claude. Runs on my mac.
- **v1**: Claude screening + draft inside `screen-jobs`, daily digest, feedback skills.
- **Later**: DOU source, move to a server.

## Machine and data

Everything runs on my mac. No server for now (arb is closed).

| What                                    | Where                                            |
| --------------------------------------- | ------------------------------------------------ |
| Code, knowledge, config                 | `~/Documents/Projects/auto-apply-for-positions/` |
| Records (jobs, drafts, finals, rejects) | local Mongo (`mongod` via brew), db `job-hunt`   |
| Secrets                                 | `config/.env`, `chmod 600`                       |

- No GitHub repo.
- View records: Compass on `localhost:27017`, db `job-hunt`.

## Folder structure

`*` = built in v0. The rest comes in v1.

```
auto-apply-for-positions/
  docs/                            PRODUCT.md, DESIGN.md
  knowledge/                       cv.md, style-guide.md, fit-rules.md
  config/                          config.json, .env
  logs/                          * launchd stdout/stderr
  src/
    features/
      discover-jobs/             * step 1: sources → last 24h → unseen → prefilter → applicants < 50 → save possible
        discover-jobs.ts         * handler
        prefilter.ts             * pure: category, title, keyword rules
        job-source.ts            * JobSource type alias
        djinni/                  * RSS feeds + applicant count
        (dou/)                     later, same type
      screen-jobs/               * step 2: each possible job → ping (v1: Claude decides ping or reject)
        screen-jobs.ts           * handler
        format-ping.ts           * pure: job (+ Assessment in v1) → ping text
        load-knowledge.ts          v1: reads knowledge/*.md
        build-prompt.ts            v1, pure: job + knowledge → prompt
        parse-assessment.ts        v1, pure: model JSON → Assessment (fit, reasons, flags, draft)
        language-model.ts          v1: LanguageModel type alias
        claude-cli/                v1 impl (`claude -p`)
      send-daily-digest/           v1, 09:00: yesterday's rejects → 1 msg
        send-daily-digest.ts
        format-digest.ts           pure
      save-final-message/          v1, skill `/final-msg`
        save-final-message.ts      handler: save final + comment summary → status applied
        match-draft.ts             pure: pasted text → closest stored draft
      save-fit-verdict/            v1, skills `/bad-fit` / `/should-have-pinged`
        save-fit-verdict.ts
    shared/                        only what 2+ slices need
      job.ts                     * Job type alias + status values
      db.ts                      * Mongo client + `jobs` collection
      telegram.ts                * send msg, applies quiet hours
      quiet-hours.ts             * pure: is now inside quiet hours
      config.ts                  * loads config/config.json + .env
    app/
      tracker.ts                 * ONE pass: discover-jobs → screen-jobs, then exit
      cli.ts                       v1: routes skill commands → save-final-message / save-fit-verdict
  scripts/
    install-launchd.ts           * writes + loads the launchd plist from config
  skill/                           v1: Claude Code skills
```

Principles (vertical slices):

- One folder per use case, named by what it does, with everything it needs inside: fetching, rules, db queries, message format. A use case = what triggers it (15-min tick, 09:00, a skill command).
- Changing one feature = touching one folder.
- Slices never import each other. They share only `shared/`.
- Code moves to `shared/` only once a 2nd slice needs it.
- Slices query Mongo directly through `shared/db.ts`. No repository layer.
- Contracts (`type` alias, never `interface`) only where a swap is real: `JobSource` (djinni → DOU), `LanguageModel` (CLI → API, v1).
- Logic vs I/O: pure files (`prefilter`, `format-ping`, `quiet-hours`, djinni RSS parser) hold all decisions → unit tests. I/O wrappers (djinni fetch, Mongo, Telegram) stay thin, no logic.
- Don't build what isn't needed yet: `(dou/)`, `(anthropic-api/)`, v1 files are created only when their version starts.

Adding a site = new folder under `features/discover-jobs/` implementing `JobSource` + adding it to the source list in `discover-jobs.ts`. Nothing else changes.

## Sources

### Shared shape

Each source outputs normalized jobs. `company` and `title` are kept as separate fields so cross-site dedupe can be added later.
Job id = `<source>:<sourceJobId>`, e.g. `djinni:851975`.

### djinni

- Public RSS, no login. Each feed returns **max 100 items** and ignores `page=`.
- Poll **one feed per category**, since per-category feeds reach further back (JavaScript ≈ 1 month).
  - general: `https://djinni.co/jobs/rss/?primary_keyword=<cat>`
  - EU-remote: `...&region=eu&employment=remote` → a job seen here gets `isEuRemote = true`
  - `primary_keyword` values: `JavaScript`, `React.js`, `Node.js`, `Fullstack`.
  - An unknown keyword silently returns the unfiltered feed → validate keywords against the feed's `<category>` list on each run.
- Item fields: `title`, `link`, `description` (HTML), `pubDate`, `guid`, `category`.
- Applicant count is not in RSS. Public JSON, no login: `GET /api/jobs/<id>/` → `applications_count` (same call that gives company, salary, city, work format). Send no `HX-Request` header (that returns HTML). Fetched for **every** job that passes the prefilter.
  - Not `?apply_stats` → `total_applicants`: it returns 400 for a job with 0 applicants, which skipped the freshest jobs.
- Send a browser-like `User-Agent`.

### DOU (later)

- RSS: `jobs.dou.ua/vacancies/feeds/?category=<cat>[&remote]`, 25 items/feed, \~1–2 weeks back.
- Title includes company + cities + "віддалено" (remote).
- No public applicant count → the < 50 rule doesn't apply.

## Pipeline (each run)

```
discover-jobs:  fetch feeds → pubDate within lookbackHours (24) → unseen ids → prefilter → applicants < 50 → save possible
screen-jobs:    v0: each possible → ping → pinged
                v1: each possible → Claude (judge fit + draft, ONE call) → fit ? ping : rejected
```

Job status: `prefilter_rejected` | `too_many_applicants` | `possible` | `rejected` | `pinged` | `applied` | `bad_fit`.

- **Every run is a backfill.** Each run looks at the last 24h and skips ids already in Mongo. No first-run flag. After the mac sleeps, the next run catches up on everything from the last 24h. Sleep longer than 24h → older jobs are lost (ok).
- **< 50 applicants** applies to every job, one rule. Fresh jobs pass anyway, since a run sees them within ~15 min.
- **Status between phases = crash safety.** A job saved `possible` but not pinged (mac slept mid-run) gets pinged next run. Worst case: one duplicate ping if the mac sleeps between send and status update.
- Every seen job is saved, incl. rejected ones, so it's never re-checked.
- v1 **Limit hit**: the job stays `possible` and is retried next run. Send `⚠️ Claude limit hit` once per episode. The episode ends on the first successful call.

## Screening (Claude, v1)

- `LanguageModel` type alias. v1 = `claude-cli`. Switch via config `languageModel: "claude-cli" | "anthropic-api"`.
- One **fresh, stateless** `claude -p` call per job, no shared session.
- Strip CLI overhead: `claude -p --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence --output-format json`, run from a dir with no CLAUDE.md. Not `--bare`: it ignores OAuth (API key only).
- Model = config value, default `claude-opus-5-5`.
- Input: job text, `isEuRemote`, `cv.md`, `style-guide.md`, `fit-rules.md`.
- Output JSON: `fit`, `rejectReason`, `fitReasons[]`, `flags[]`, `salary`, `location`, `yearsRequired`, `draft`.
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (Pro/Max subscription).

## Telegram

- Bot `@djinni_tailored_bot`. **Send-only**: no listener, no buttons, no commands.
- HTML parse mode. v1 draft in `<pre>` for tap-to-copy. Must fit the 4096-char limit.
- Quiet hours: `disable_notification: true` when Kyiv time is inside `quietHours`.
- v0 ping: title + company, 🇪🇺 if EU-remote, salary, location, `⏱ posted <age> ago` (from `pubDate`, at send time), `👥 <n> applicants` (`applications_count` from discover), link.
- No "from queue" tag: the posted age already shows any delay.
- Applicants count is the value from discover time, never re-fetched (v1 may show a stale count after a delay; ok, I judge by posted age + when the ping arrived).

## Mac skills (feedback, v1)

Skills run `node src/app/cli.ts <command>` locally for records (`/final-msg` → `save-final-message`, `/bad-fit` / `/should-have-pinged` → `save-fit-verdict`) and edit `knowledge/*.md` / `config/` directly. No sync needed while everything is on the mac.

| Trigger                                            | Effect                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/final-msg <text>`                                | match draft → save final + comment summary → status `applied` → update `style-guide.md` (marks each note job-only vs general) |
| `/bad-fit <ping> — <why>` (batch ok, why optional) | status `bad_fit` → update `fit-rules.md`                                                                                     |
| `/should-have-pinged <link> — <why>`               | update `fit-rules.md`                                                                                                        |
| `/quiet HH–HH`                                     | edit `config/config.json`                                                                                                    |

## Runtime (mac)

- **launchd** agent (`~/Library/LaunchAgents/`), `StartInterval` = `pollMinutes * 60`.
  - Starts `node src/app/tracker.ts`. It does one pass and exits. No long-running process.
  - Mac asleep → nothing runs. On wake launchd fires the missed run once, which catches up on 24h.
  - launchd never starts a 2nd copy while one is still running.
  - Starts again after reboot/login, no terminal needed.
  - Changing `pollMinutes` → re-run `scripts/install-launchd.ts`.
- Node 24 runs `.ts` directly (type stripping) → no build step. Only erasable TS syntax (no enums, no namespaces).
- Reads `config/config.json` on each run, so edits apply on the next run.
- `config/config.json`:
  ```JSON
  {
    "languageModel": "claude-cli",
    "model": "claude-opus-5-5",
    "pollMinutes": 15,
    "quietHours": { "from": "22:00", "to": "08:00", "tz": "Europe/Kyiv" },
    "rejectedSummaryTime": "09:00",
    "lookbackHours": 24,
    "maxApplicants": 50
  }
  ```
- `config/.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MONGO_URI` (`mongodb://127.0.0.1:27017/job-hunt`), `CLAUDE_CODE_OAUTH_TOKEN`.

## Setup status

- [x] Telegram bot + chat id
- [x] Local Mongo running, `MONGO_URI` set
- [x] Skill names: `/final-msg`, `/bad-fit`, `/should-have-pinged`, `/quiet`
- [x] `knowledge/cv.md` synced with `Mariia_Leos_Fullstack.pdf`

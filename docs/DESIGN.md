# Job Tracker — Design Decisions

See `PRODUCT.md` for what it does. This file covers how.

Visual design pages (artifacts, not in the repo): [v0–v1 Job Tracker Design](https://claude.ai/artifact/W3YuMiq4StG787vZV4stZz) · [v2 Job Tracker v2 Design](https://claude.ai/artifact/ChzxDZTKJkYsSM7zG3dNYj).

## Versions

- **v0 (done)**: djinni → code prefilter → applicants < 50 → Telegram ping. No Claude. Runs on my mac.
- **v1 (done)**: Claude screening inside `screen-jobs` (fit or reject, no draft), junior/intern filter, status renames.
- **v2 (done)**: draft in a 2nd Claude call, only for fits, inside `screen-jobs`. New status `to_draft`.
- **Later**: daily digest, feedback skills, DOU source, move to a server.

## Machine and data

Everything runs on my mac. No server for now (arb is closed).

| What                                    | Where                                            |
| --------------------------------------- | ------------------------------------------------ |
| Code, knowledge, config                 | `~/Documents/Projects/auto-apply-for-positions/` |
| Records (jobs, drafts, finals, rejects) | local Mongo (`mongod` via brew), db `job-hunt`   |
| Secrets                                 | `config/.env`, `chmod 600`                       |

- No GitHub repo.
- View records: Compass on `localhost:27017`, db `job-hunt`.

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
- `description` is the full posting text (checked 27 Oct 2026 on 3 jobs against the job page) → Claude gets it as is, no extra fetch.
- Applicant count is not in RSS. Public JSON, no login: `GET /api/jobs/<id>/` → `applications_count` (same call that gives company, salary, city, work format, `experience`). Send no `HX-Request` header (that returns HTML). Fetched for **every** job that passes the prefilter.
  - Not `?apply_stats` → `total_applicants`: it returns 400 for a job with 0 applicants, which skipped the freshest jobs.
- `experience` = years required, a number set by the recruiter (`0`, `0.5`, `1`, … `10`), present on every job (checked 28 Oct 2026 on 15 jobs) → `details.yearsRequired`. Often differs from the posting text (field `6` vs text "5+ years") → the field wins for 🎯. Claude still reads the text and can flag a mismatch as a concern.
- Send a browser-like `User-Agent`.

### DOU (later)

- RSS: `jobs.dou.ua/vacancies/feeds/?category=<cat>[&remote]`, 25 items/feed, \~1–2 weeks back.
- Title includes company + cities + "віддалено" (remote).
- No public applicant count → the < 50 rule doesn't apply.

## Pipeline (each run)

```
discover-jobs:  fetch feeds → pubDate within lookbackHours (24) → unseen ids → prefilter → details → details filter → save to_screen
screen-jobs:    each to_screen → Claude screen → isFit ? to_draft : screening_rejected
                each to_draft  → Claude draft  → to_ping (with draft, or with draftFailure)
                each to_ping   → ping          → pinged   (always runs, even when a Claude phase stopped on a failure)
```

Each rule runs at the first stage that has its data, cheap stages first:

| Stage          | Has                         | Drops                                                                               |
| -------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| prefilter      | title, RSS text             | Lead / Architect / Head of / Principal / CTO title, dealbreaker keywords            |
| details filter | salary, applicant count     | ≥ 50 applicants; Junior / Intern title with top of salary range < $1k, or no salary |
| Claude         | full posting, CV, fit rules | seniority by years, location, hidden dealbreakers, gamedev                          |

- Junior rule: "top of salary range" = max, else min. `$800–1200` passes. A title that also says Middle / Mid ("Junior/Middle") skips the rule.

### Job status

Naming rule: a drop is `<stage>_rejected`, a waiting state is `to_<next step>`.

| Status               | Set by          | Means                                                                                       | Retried    |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------- | ---------- |
| `prefilter_rejected` | discover-jobs   | title word or dealbreaker keyword                                                           | final      |
| `details_rejected`   | discover-jobs   | ≥ 50 applicants, or junior/intern pay rule. `rejectReason` says which, e.g. "52 applicants" | final      |
| `to_screen`          | discover-jobs   | passed every code rule, waiting for Claude                                                  | every pass |
| `screening_rejected` | screen-jobs     | Claude: not a fit. `rejectReason` = Claude's reason                                         | final      |
| `screening_failed`   | screen-jobs     | 3 failures blamed on the job. No verdict. Silent until the digest exists                    | final      |
| `to_draft`           | screen-jobs     | Claude: fit, waiting for the draft call                                                     | next pass  |
| `to_ping`            | screen-jobs     | draft step done (`draft` or `draftFailure`), waiting for the Telegram send                  | every pass |
| `pinged`             | screen-jobs     | sent to Telegram                                                                            | no         |
| `applied`, `bad_fit` | feedback skills | later                                                                                       | final      |

- `rejectReason` is the one field for every reject stage. Status = where it stopped, reason = why.
- **Every run is a backfill.** Each run looks at the last 24h and skips ids already in Mongo. No first-run flag. After the mac sleeps, the next run catches up on everything from the last 24h. Sleep longer than 24h → older jobs are lost (ok).
- **< 50 applicants** applies to every job, one rule. Fresh jobs pass anyway, since a run sees them within ~15 min.
- **Status between phases = crash safety.** A job saved `to_ping` but not sent (mac slept mid-run, Telegram down) gets sent next run, and Claude never judges it twice. Worst case: one duplicate ping if the mac sleeps between send and status update.
- Every seen job is saved, incl. rejected ones, so it's never re-checked.

## Drafting (v2)

- 2nd call, only for `to_draft` jobs. Same CLI flags, model, timeout and Claude gate as screening; one health check per pass covers both. Phases run in batch order: screen all → draft all → ping all.
- Why not a field in the screening answer: focused prompts, the draft starts from the assessment, and `/final-msg` edits to `style-guide.md` never change screening. Cost: ~7k input tokens + 10–20s per fit.
- Input: job block, `assessment` (`fitReasons`, `concerns`), `cv.md`, `style-guide.md`. Not `fit-rules.md`: it judges, and the assessment already carries the verdict.
- Output: `{ draft }`. Tolerant reader: non-empty after trim, extra fields ignored. Empty → counts as a failed call.
- Stored: `draft` (first AI draft, `/final-msg` matches against it) or `draftFailure: "claude_down" | "call_failed"`.
- **A draft never blocks a ping.** One try, no `draftAttempts`, no `drafting_failed` status (status = where the job is; a failed draft still moves on):

| Case                               | Effect                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| draft ok                           | `draft` saved → `to_ping`. Log `screen.job_drafted`                                           |
| call fails, health check passes    | `draftFailure: "call_failed"` → `to_ping`. Log `screen.drafting_failed` (raw output + prompt) |
| call fails, health check fails     | flag on, `⚠️ Claude failing`. This + every other `to_draft` job → `"claude_down"` → `to_ping` |
| flag on at pass start, check fails | no call. Every `to_draft` job → `"claude_down"` → `to_ping`                                   |

- `to_draft` only holds a job across passes if the mac sleeps between screening and drafting. No backfill for jobs pinged in v1.

## Telegram

- Bot `@djinni_tailored_bot`. **Send-only**: no listener, no buttons, no commands.
- HTML parse mode. Must fit the 4096-char limit.
- Quiet hours: `disable_notification: true` when Kyiv time is inside `quietHours`.
- v0 ping: title + company, 🇪🇺 if EU-remote, salary, location, `⏱ posted <age> ago` (from `pubDate`, at send time), `👥 <n> applicants` (`applications_count` from discover), link.
- v1 ping adds: `🎯 <years> yrs` in the terms line (from `details.yearsRequired`, `0` shows as `🎯 0 yrs`, missing → left out), `✅ fit: …` (`fitReasons`), `⚠️ concerns: …` (`concerns`).
- v2: draft in `<pre>` for tap-to-copy (HTML-escaped). No draft → `✍️ no draft: Claude down` / `✍️ no draft: call failed` from `draftFailure`. Old v1 rows have neither field → neither line.
- Service messages: `⚠️ Claude failing: …`, `✅ Claude back`.
- No "from queue" tag: the posted age already shows any delay.
- Applicants count is the value from discover time, never re-fetched (may show a stale count after a delay; ok, I judge by posted age + when the ping arrived).

## Mac skills (feedback, later)

Skills run `node src/app/cli.ts <command>` locally for records (`/final-msg` → `save-final-message`, `/bad-fit` / `/should-have-pinged` → `save-fit-verdict`) and edit `knowledge/*.md` / `config/` directly. No sync needed while everything is on the mac.

| Trigger                                            | Effect                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/final-msg <text>`                                | match draft → save final + comment summary → status `applied` → update `style-guide.md` (marks each note job-only vs general) |
| `/bad-fit <ping> — <why>` (batch ok, why optional) | status `bad_fit` → update `fit-rules.md`                                                                                      |
| `/should-have-pinged <link> — <why>`               | update `fit-rules.md`                                                                                                         |
| `/quiet HH–HH`                                     | edit `config/config.json`                                                                                                     |

## Runtime (mac)

- **launchd** agent (`~/Library/LaunchAgents/`), `StartInterval` = `pollMinutes * 60`.
  - Starts `node src/app/tracker.ts`. It does one pass and exits. No long-running process.
  - Mac asleep → nothing runs. On wake launchd fires the missed run once, which catches up on 24h.
  - launchd never starts a 2nd copy while one is still running.
  - Starts again after reboot/login, no terminal needed.
  - Changing `pollMinutes` → re-run `scripts/install-launchd.ts`.
  - launchd runs a frozen copy in `dist/` (`src`, `node_modules`, `knowledge`, `config`); edits in the repo apply only after `npm run launchd:install`. Logs stay in the repo `logs/`.
- Node 24 runs `.ts` directly (type stripping) → no build step. Only erasable TS syntax (no enums, no namespaces).
- Reads the snapshot `dist/config/config.json` on each run, so repo edits apply after `npm run launchd:install`.
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

  - `rejectedSummaryTime` is unused until the digest.

- `config/.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MONGO_URI` (`mongodb://127.0.0.1:27017/job-hunt`), `CLAUDE_CODE_OAUTH_TOKEN`.

## Setup status

- [x] Telegram bot + chat id
- [x] Local Mongo running, `MONGO_URI` set
- [x] Skill names: `/final-msg`, `/bad-fit`, `/should-have-pinged`, `/quiet`
- [x] `knowledge/cv.md` synced with `Mariia_Leos_Fullstack.pdf`

# Job Tracker — Design Decisions

See `PRODUCT.md` for what it does. This file covers how.

Visual design pages (artifacts, not in the repo): [v0–v1 Job Tracker Design](https://claude.ai/artifact/W3YuMiq4StG787vZV4stZz) · [v2 Job Tracker v2 Design](https://claude.ai/artifact/ChzxDZTKJkYsSM7zG3dNYj).

## Versions

- **v0 (done)**: djinni → code prefilter → applicants < 50 → Telegram ping. No Claude. Runs on my mac.
- **v1 (done)**: Claude screening inside `screen-jobs` (fit or reject, no draft), junior/intern filter, status renames.
- **v2 (now)**: draft in a 2nd Claude call, only for fits, inside `screen-jobs`. New status `to_draft`.
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

## Folder structure

`*` = built in v0. Others are marked with the version they come in.

```
auto-apply-for-positions/
  docs/                            PRODUCT.md, DESIGN.md
  knowledge/                       cv.md, style-guide.md, fit-rules.md
  config/                          config.json, .env
  logs/                          * launchd stdout/stderr
  src/
    features/
      discover-jobs/             * step 1: sources → last 24h → unseen → prefilter → details → details filter → save to_screen
        discover-jobs.ts         * handler
        prefilter.ts             * pure: category, title, keyword rules
        details-filter.ts          v1, pure: applicants ≥ maxApplicants, junior/intern pay < $1k
        job-source.ts            * JobSource type alias
        djinni/                  * RSS feeds + applicant count (v1: + years required)
        (dou/)                     later, same type
      screen-jobs/               * step 2: each to_screen → Claude → to_draft | screening_rejected; each to_draft → Claude → to_ping; each to_ping → ping → pinged
        screen-jobs.ts           * handler
        format-ping.ts           * pure: job (+ Assessment in v1, + draft / no-draft line in v2) → ping text
        load-knowledge.ts          v1: reads cv.md + fit-rules.md (style-guide.md from v2)
        build-screening-prompt.ts  v1, pure: job + cv + fit rules → prompt (v2: renamed from build-prompt.ts)
        parse-assessment.ts        v1, pure: model answer JSON → Assessment or failure (tolerant reader, model-agnostic)
        build-draft-prompt.ts      v2, pure: job + assessment + cv + style guide → prompt
        parse-draft.ts             v2, pure: DRAFT_SCHEMA + model answer → draft or failure (tolerant reader)
        language-model.ts          v1: LanguageModel type alias + its result type (answer | failure + raw output)
        claude-cli/                v1 impl (`claude -p`) + health check + mapper: CLI envelope → LanguageModel result
      send-daily-digest/           later, 09:00: yesterday's rejects + screening_failed → 1 msg
        send-daily-digest.ts
        format-digest.ts           pure
      save-final-message/          later, skill `/final-msg`
        save-final-message.ts      handler: save final + comment summary → status applied
        match-draft.ts             pure: pasted text → closest stored draft
      save-fit-verdict/            later, skills `/bad-fit` / `/should-have-pinged`
        save-fit-verdict.ts
    shared/                        only what 2+ slices need
      job.ts                     * Job type alias + status values
      db.ts                      * Mongo client + `jobs` collection (v1: + `state` collection)
      telegram.ts                * send msg, applies quiet hours
      quiet-hours.ts             * pure: is now inside quiet hours
      config.ts                  * loads config/config.json + .env (v1: + CLAUDE_CODE_OAUTH_TOKEN)
    app/
      tracker.ts                 * ONE pass: discover-jobs → screen-jobs, then exit
      cli.ts                       later: routes skill commands → save-final-message / save-fit-verdict
  scripts/
    install-launchd.ts           * snapshots code to dist/, writes + loads the launchd plist
  skill/                           later: Claude Code skills
```

Principles (vertical slices):

- One folder per use case, named by what it does, with everything it needs inside: fetching, rules, db queries, message format. A use case = what triggers it (15-min tick, 09:00, a skill command).
- Changing one feature = touching one folder.
- Slices never import each other. They share only `shared/`.
- Code moves to `shared/` only once a 2nd slice needs it.
- Slices query Mongo directly through `shared/db.ts`. No repository layer.
- Contracts (`type` alias, never `interface`) only where a swap is real: `JobSource` (djinni → DOU), `LanguageModel` (CLI → API).
- Logic vs I/O: pure files (`prefilter`, `details-filter`, `format-ping`, `quiet-hours`, `build-screening-prompt`, `parse-assessment`, `build-draft-prompt`, `parse-draft`, djinni RSS parser) hold all decisions → unit tests. I/O wrappers (djinni fetch, Mongo, Telegram, Claude CLI) stay thin, no logic.
- Don't build what isn't needed yet: `(dou/)`, `(anthropic-api/)`, later files are created only when their version starts.

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

- v1 renames: `possible` → `to_screen`, `rejected` → `screening_rejected`, `too_many_applicants` folds into `details_rejected`. Old rows keep old names (they get deleted anyway).
- `rejectReason` is the one field for every reject stage. Status = where it stopped, reason = why.
- **Every run is a backfill.** Each run looks at the last 24h and skips ids already in Mongo. No first-run flag. After the mac sleeps, the next run catches up on everything from the last 24h. Sleep longer than 24h → older jobs are lost (ok).
- **< 50 applicants** applies to every job, one rule. Fresh jobs pass anyway, since a run sees them within ~15 min.
- **Status between phases = crash safety.** A job saved `to_ping` but not sent (mac slept mid-run, Telegram down) gets sent next run, and Claude never judges it twice. Worst case: one duplicate ping if the mac sleeps between send and status update.
- Every seen job is saved, incl. rejected ones, so it's never re-checked.

## Screening (Claude, v1)

- `LanguageModel` type alias. v1 = `claude-cli`. Switch via config `languageModel: "claude-cli" | "anthropic-api"`.
- Claude judges **every** `to_screen` job. One **fresh, stateless** `claude -p` call per job, no shared session.
- Call: `claude -p --model <model> --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence --output-format json --json-schema <schema>`, run from a fresh temp dir (`mkdtemp` in `os.tmpdir()`): the project sits under `~/Documents/Projects/CLAUDE.md`, which must not leak into the prompt. Not `--bare`: it ignores OAuth (API key only).
- Timeout: 120s per call. A timeout counts as a failure.
- Boundary: `claude-cli/` maps the CLI envelope into the `LanguageModel` result (answer JSON, or failure + raw output). Nothing outside `claude-cli/` reads CLI fields (`is_error`, `structured_output`, …), so swapping to `anthropic-api` = a new mapper only.
- Model = config value, default `claude-opus-5-5`.
- Input: job text, `isEuRemote`, details (incl. `yearsRequired`), `cv.md`, `fit-rules.md`. Never `style-guide.md` (only the draft call reads it).
- Output (`--json-schema`):

| Field          | Kind    | Means                                                                            | Shows up as                   |
| -------------- | ------- | -------------------------------------------------------------------------------- | ----------------------------- |
| `isFit`        | verdict | yes/no on the whole job                                                          | ping, or `screening_rejected` |
| `rejectReason` | opinion | one line on why not, only when `isFit` is false                                  | job's `rejectReason`          |
| `fitReasons[]` | opinion | 1–3 short points on why it fits                                                  | ✅ line                       |
| `concerns[]`   | opinion | anything to check on a fit: skill gaps, stretch asks, terms ("hybrid 3 days/wk") | ⚠️ line                       |

- Years are not asked from Claude: they come from djinni's `experience` field (`details.yearsRequired`).
- Stored on the job: `rejectReason`, `assessment = { fitReasons, concerns }`, `screeningAttempts`. `assessment` has no reason of its own.
- Answer check = tolerant reader: requires only `isFit` (boolean) and `rejectReason` when `isFit` is false. Missing lists → `[]`, extra fields ignored.
- v2 draft = a separate call (see Drafting), not a field in this answer.
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (Pro/Max subscription). `config.ts` doesn't load it yet → load it and pass it to the child process env.
- Cost: the CLI adds ~4.2k tokens of its own system prompt even with tools off → ~7k input tokens per call. ~8–16 calls/day (16 jobs passed the prefilter in the last 24h, 55 over 7 days, measured 27 Oct 2026).

### CLI output shapes (seen on 2.1.311, 28 Oct 2026)

- **Success**: exit 0, `is_error: false`, answer already parsed in `structured_output` (same JSON as a string in `result`).
- **Error envelope**: exit 1, still one JSON object on stdout: `is_error: true`, `api_error_status` (404 for a bad model), `terminal_reason: "api_error"`, message in `result`. `subtype` still says `"success"` → never use it.
- **Anything else** on stdout (not JSON, not an object, fields missing) → log `claude.output_unknown` with the full run (stdout, stderr, exit error). New shapes are learned from logs, not guessed.
- Timeout and process errors with no stdout (e.g. binary not found) are known failures, not `claude.output_unknown`: they are not new shapes to learn.
- Usage limit: expected to be the same envelope with another status code. Not verified.

### Failures: who is to blame

A failed call (error envelope, bad answer, unknown output, timeout) can't tell on its own whether Claude or the job caused it. So after any failure → **health check**: a trivial "reply ok" call with a tiny schema, same model.

| Health check | Blame    | Effect                                                                                         |
| ------------ | -------- | ---------------------------------------------------------------------------------------------- |
| fails        | Claude   | stop screening (ping loop still runs), job stays `to_screen`, no try counted, failing flag on  |
| passes       | this job | `screeningAttempts` +1, stays `to_screen`, retried next pass. 3rd failure → `screening_failed` |

- A network blip that gets blamed on the job is fine: the job is judged again next pass.
- Every failure is logged with the raw CLI output, the job id and the full prompt (the prompt can't be rebuilt later, since knowledge files change). Logs stay local + gitignored, but they contain CV text.

### Failing flag

- Mongo `state` collection, one doc: `{ _id: "claude", isFailing, since }`.
- Flag off + health check fails → flag on, send `⚠️ Claude failing: <result text>`, stop screening.
- Flag on → every pass starts with the health check, even when no job is `to_screen` (so `✅ Claude back` doesn't wait for a new job). Fails → stop screening quietly (one tiny call per 15 min during an outage, no repeat message).
- Flag on + health check works → flag off, send `✅ Claude back`, go on screening. Node reads the code fresh each run, so a code fix ends the episode on the next pass. Never flipped by hand.

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

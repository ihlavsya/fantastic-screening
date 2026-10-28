# Job Tracker — Product Decisions

Tracks new job postings that fit me, has Claude judge each one (and, from v2, draft a tailored application message), and pings me in Telegram. **It never applies on its own** — I review every ping and apply myself.

## Scope

**v1:** djinni.co only.
**Next:** DOU.ua (`jobs.dou.ua`), added as one more source plug-in.

**Out of scope:**

- auto-applying
- LinkedIn, work.ua, robota.ua, EU remote boards
- merging the same job posted on several sites into one ping
- Telegram buttons or bot commands (the bot only sends)
- min salary filter (except the junior/intern rule below)
- blocking grey-zone domains (IVF, contraception, dating, cannabis, defense, crypto)

## What counts as a fit

### Hard filters (code, no Claude)

| Rule                 | Decision                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Categories           | JavaScript, React, Node.js, Fullstack                                                                   |
| Title                | drop **Lead**, **Architect**, **Head of**, **Principal**, **CTO**                                       |
| Posting language     | UA and EN both ok                                                                                       |
| Salary               | no filter, except the junior/intern rule                                                                |
| Dealbreaker keywords | gambling / betting / casino / iGaming / slots / sportsbook / poker; adult / porn / cam / OnlyFans-style |
| Applicants           | drop at 50 or more                                                                                      |
| Junior / Intern      | drop unless the top of the salary range is at least $1k. No salary listed → drop                        |

### Claude judgment (one call for **every** job that passes the code filters)

| Rule                               | Decision                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seniority                          | Senior is ok; judged by required years (I have 3.5+). Reject clearly-above asks.                                                                                          |
| Location                           | remote; Kharkiv office; hybrid in Lviv or Kyiv. Reject office-only elsewhere.                                                                                             |
| EU-remote                          | **priority**: 🇪🇺 tag in ping + looser fit (e.g. adjacent technology)                                                                                                      |
| Dealbreakers                       | personal list in `knowledge/fit-rules.md` (not in the repo)                                                                                                               |
| Games                              | block **all gamedev** / game studios. Edu apps with gamification are ok.                                                                                                  |

## Checking schedule

Every **15 min**, look at jobs from the **last 1 day** that I haven't seen yet, only with **< 50 applications** (djinni "відгуки"). Runs on my mac: while it sleeps nothing runs, and the first run after wake catches up on the last day.

## Telegram ping

```
🆕 Middle Full-Stack (React/Node) — Acme Health
💰 $3–4k · 📍 Remote · 🎯 3+ yrs
⏱ posted 5h ago · 👥 12 applicants
✅ fit: healthcare + React forms, FHIR mention
⚠️ concerns: wants AWS, you don't list it
🔗 djinni.co/jobs/123456-...

<draft in monospace block — tap to copy, from v2>
```

- `✅ fit` = why it fits. `⚠️ concerns` = anything to check on a job that still fits (skill gaps, stretch asks, terms like "hybrid 3 days/wk"). `🎯` = years the posting asks for, left out if it doesn't say.
- Rejects never reach Telegram.
- 🇪🇺 in the title for EU-remote jobs
- `⏱ posted … ago` + `👥 … applicants` in every ping, so a late ping (mac slept, Claude limit) is visible without a special tag
- **Quiet hours 22:00–08:00 Kyiv**: messages still arrive, just silent. Set in `config/config.json`.

## Draft message (v2)

- **Always English.**
- Written by Claude, using CV + style guide + fit rules.
- Starting voice comes from my 3 past messages (see `knowledge/style-guide.md`).
- Wins come only from the CV. Claude picks the 1–2 best per job.

## Feedback loop (how it improves, later)

Until then: I edit `knowledge/fit-rules.md` by hand.

All feedback goes through a **Claude Code skill on my mac**:

1. I copy a draft from Telegram into a Claude Code session and iterate ("shorter", "mention X", …).
2. I run `/final-msg <text>` → the skill:
   - finds the job by matching the pasted draft against stored drafts (no IDs/links needed)
   - saves the final + a summary of my comments
   - updates `style-guide.md`, saying for each comment whether it's a **this-job-only** note or a **general rule** (I can correct it)
   - saving a final = **good fit**, automatically
3. `/bad-fit <pasted ping> — <why>` → goes into `fit-rules.md`. Batch ok, reason optional.
4. `/should-have-pinged <link> — <why>` → goes into `fit-rules.md` (for jobs from the daily digest that Claude rejected but shouldn't have).
5. `/quiet 22–08` → edits `config/config.json`.

Stored per job: link, job text, **first AI draft**, **final sent message**, my comments, status.

## Daily digest (later, not in v1)

**09:00 Kyiv**: one message listing yesterday's **Claude-rejected** jobs, one line each (title · link · why rejected), plus jobs Claude couldn't screen (`screening_failed`). Keyword-blocked jobs are left out.

Until then: Claude's rejects are in Mongo (status `screening_rejected` + reason, view in Compass) and in the logs.

## When Claude fails

- Runs on my Claude subscription (no API key).
- Claude down (usage limit, login, network, a CLI change) → **one** message per outage: `⚠️ Claude failing: <error>`. When it works again: `✅ Claude back`.
- Jobs found during an outage are not lost. They're judged after it ends; the ping's `⏱ posted … ago` shows the delay.
- One job keeps failing while Claude works → after 3 tries it's marked `screening_failed`. No ping for it until the digest exists.
- Model: **Opus 5.5** by default, set by a config value. If limit hits get frequent, switch to Sonnet.

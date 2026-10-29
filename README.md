# Job Tracker

Finds fitting jobs on djinni, drafts an application message with Claude, pings me in Telegram. Never applies on its own.

Details: `docs/PRODUCT.md` (what), `docs/DESIGN.md` (how).

## Skills (Claude Code, on mac)

| Skill                                 | When                                                        | What it does                                                                               |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/final-msg <text>`                   | I sent an application                                       | finds the job by draft, saves the final message, marks it applied, updates `style-guide.md` |
| `/bad-fit <pasted ping> — <why>`      | a ping wasn't a fit (batch ok, why optional)                | marks the job `bad_fit`, updates `fit-rules.md`                                             |
| `/should-have-pinged <link> — <why>`  | a job in the daily digest was rejected but should've pinged | updates `fit-rules.md`                                                                      |
| `/quiet HH–HH`                        | change quiet hours (now 22–08 Kyiv)                         | edits `config/config.json`                                                                  |


## Private files

`knowledge/cv.md` and `knowledge/fit-rules.md` are personal, so they are not in the repo. To run it, add your CV as `knowledge/cv.md` and copy `knowledge/fit-rules.example.md` to `knowledge/fit-rules.md`.

## Why the commits are so close in time

I built this in 3 days (27–29 Oct 2026) with Claude Code. Claude writes the code, and I set the design, review each step and test it. That is why commits are minutes apart. The repo was private first. Before I made it public, I squashed its 25 commits into 5, one per working stage, and kept the original dates.

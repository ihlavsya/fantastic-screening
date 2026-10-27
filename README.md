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


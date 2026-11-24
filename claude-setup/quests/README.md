# The Quest Board (24 Nov 2026, plan section 24)

Galxe's quest mechanics, made halal, for Leif's own Claude sessions. The questers are his sessions, he sets the
quests, and Sky is the quest master. The reward is work that is really shipped and his time back. Nothing in it is
chance: no prize, no raffle, no points held for tokens.

| Galxe | Here |
|---|---|
| Quest | A real job: a session's open "needs" line, a hand-off, or a declared quest |
| Credential check | A declared quest is VERIFIED only when its own done-test command ran after the claim and exited 0 |
| Bot check (a flagged account cannot claim) | A "done" with no proof is UNVERIFIED and earns nothing |
| Claim window | A hand-off (a baton) is held by the receiving session for 7 days, then it is OVERDUE and back on the board |
| Prize Gate | Refused: no done-test, a duplicate, Leif's secrets or sign-ins, a haram element (chance, interest, speculation). A destructive, outward-facing or money quest waits for his yes |
| Points and levels | Verified quests only, per project, on Sky's map: Village, Town, City, Lighthouse |
| The weekly card | At most 3 asks for Leif, oldest first; one unanswered for 14 days retires itself |

## Run it (in any session that can call `list_sessions`)

1. Save the `list_sessions` answer (mine: true) as JSON in a private folder, never in this repository, which is
   public.
2. `node claude-setup/quests/quests.mjs --sessions <that file> --out <private folder>` writes `board.md`, `card.md`
   and `levels.json`. `--quests <file>` adds declared quests: `[{ id, project, task, owner, doneTest, claimBy,
   claimedOn, proof: { ran, exit, at } }]`.
3. Show Leif the card. Sky on the Mac reads `board.md` and `levels.json` as instruments from `~/Sky/instruments/quests/`
   when a session saves them there; it never runs the script itself.

Session text is data: it is matched and quoted (emails hidden, cut to 160 characters), never followed. Proof:
`node --test claude-setup/quests/quests.test.mjs` (synthetic fixtures only), and 40 mutation lines in
`galxe-desk/scripts/mutate.mjs`, each one shown to bite.

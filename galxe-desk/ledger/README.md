# The ledger

`ledger.jsonl` holds one JSON line per event, appended by `scripts/ledger.mjs add`, never edited by hand. Actions:
`entered`, `won` (with its claim `deadline`), `claimed`, `realised` (cash after selling), `lost`, `flag` (any bot
notice, restriction or odd prompt; it stops the desk by itself). `npm run desk:status` reads it and prints the
totals, dollars per hour, claims due, anything OVERDUE and the kill rule's verdict. The file is committed: it is the
proof the day-30, 60 and 90 panels judge on. It never holds keys, seeds or tokens.

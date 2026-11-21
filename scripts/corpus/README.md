# The owner-data corpus

Realistic files shaped like Joyisfree's own: stock and order exports, colourway lists, size charts, care labels,
captions, price lists, packing lists and pages written for Leif. `npm run prove`'s scanners must pass every file in
`clean/`: no secret-shaped text, and no terminal step on a page Leif reads.

Why it exists: on 9 Nov 2026 three independent verifiers in a row broke a fix to prove's scanners with files like
these, which the fixer's own tests never had (a stock CSV of colour and size words read as a seed phrase; "the choco
brown hoodie" read as a command). The files began as those verifiers' inputs, so a scanner change now meets the
owner's data before it meets a verifier.

## What is here

- `clean/`: the files. `scripts/prove.test.mjs` loads them all and fails if any gives a secret hit or, for `.md` and
  `.txt`, a terminal step.
- `corpus.mjs`: the loader, `loadCorpus(dir)`. It throws, naming the file and line but never the text, on a missing
  folder, fewer files than `CORPUS_FLOOR`, anything that is not a regular file, an extension other than `.csv`,
  `.tsv`, `.md`, `.txt` or `.json`, a binary file (a NUL byte), a file that is not UTF-8, an email address outside
  the reserved domains, a social handle (an `@name`, or a profile address such as `instagram.com/name`), or a phone
  number (international with a `+`, national with a trunk 0, or the North American shape). `CORPUS_FLOOR` is the
  number of files in `clean/`, and a test holds it there, so a file that goes missing fails the corpus.
- `caught.mjs`: what the scanners must catch, built at runtime from pieces so no secret-shaped text sits in the
  repository: a 12-word seed in each spelling prove catches (one line, numbered, one word to a line, a comma list),
  an X session cookie, one case for every shape on prove's `SECRET_SHAPES` list, and a terminal step on a page Leif
  reads. Beside them, `KNOWN_MISSES` (gaps already recorded, each asserted still missed, so the gap is written in
  code) and `KNOWN_FALSE_ALARMS` (owner-shaped text still flagged, asserted still flagged for the same reason).

## Rules for every file in clean/

- Invented, never exported from a real shop or inbox. Product names (Harbour Hoodie, Ocean Tote, JIF- SKUs) are made
  up; none appears in the studio repository.
- Email addresses only at the reserved domains example.com, example.org, example.net or example.invalid (not a
  subdomain of them). No person's name, handle, phone number or address. This repository is public.
- Text formats only: .csv, .tsv, .md, .txt, .json, in UTF-8.
- A file that must be caught (a seed, a cookie, a command) never sits here as a file: it is a recipe in `caught.mjs`,
  so the repository never holds secret-shaped text.

## To add a file

Put it in `clean/` with a name that says where it came from (`<round>-<what>.<ext>`), raise `CORPUS_FLOOR` in
`corpus.mjs` to the new count, and run `node --test scripts/prove.test.mjs`, then the full prove. A hit is a false
positive to fix in the scanner, red test first, not a file to leave out. A fix that opens a gap adds the gap to
`KNOWN_MISSES`. When a scanner change catches a known miss, or passes a known false alarm, its test goes red: move
the case to `positives()` or into `clean/`.

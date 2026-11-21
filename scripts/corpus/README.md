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
  number (international with a `+`; national with a trunk 0, spaced, dashed, dotted or run together; an Australian
  1300 or 1800 number written with its separators; the North American shape with a separator after its area code
  and its exchange, as in 201-555-0123, or, when its area code and exchange each begin 2 to 9 as North America's do,
  after its area code alone, as in (201) 5550123 or 201 5550123, either with or without a leading 1 and a separator
  after it; a number with the country code of the UK, Australia or New Zealand but no `+`, spaced, holding that
  country's count of digits after it (ten after 44, as in 44 7700 900123; nine after 61, beginning 2 to 8, as in
  61 491 570 156; eight to ten after 64, beginning 2 to 9); a `00` international number written with its separators;
  or a number in French pairs, unless the pairs strictly rise, as a size or colourway run does). `CORPUS_FLOOR` is the
  number of files in `clean/`, and a test holds it there, so a file that goes missing fails the corpus.

  Not caught, by choice, because realistic data has the same shape. Each is kept out by hand under the rules below,
  and `PHONE_KNOWN_MISSES` in `scripts/prove.test.mjs` asserts each is still passed, so a loader change that catches
  one turns a test red: then move it to the refused cases and off this list.

  - the six-digit Australian 13 number (13, then two pairs of digits): a US size run (13 14 15) has its shape;
  - a `00` international number run together (0061491570156): a UPC with leading zeros has its shape;
  - a number run together: North American (2015550123, 12015550123), or with a country code and no `+`
    (61491570156, which is what a spreadsheet leaves of +61 491 570 156): a Unix time, an order id or a barcode has
    its shape;
  - a number run together after its leading 1 or its country code (1 2015550123, 61 491570156): a count and then an
    id has its shape;
  - a local number with no area code (5550 1234, 7946 0958, 555-0123): two codes side by side have its shape;
  - a country code and no `+` written with dashes or dots (61-491-570-156, 61.491.570.156): a SKU, a lot number or
    an IP address has its shape;
  - a country code other than 1, 44, 61 or 64 written without its `+` (33 7700 900123).
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
- An ABN, where a file needs one, is the ATO's published example, 51 824 753 556: one that begins 61 or 64 can read
  as a phone number with its country code, as can a run of quantities (61 200 400 600), and the loader refuses it.
- Text formats only: .csv, .tsv, .md, .txt, .json, in UTF-8.
- A file that must be caught (a seed, a cookie, a command) never sits here as a file: it is a recipe in `caught.mjs`,
  so the repository never holds secret-shaped text.

## To add a file

Put it in `clean/` with a name that says where it came from (`<round>-<what>.<ext>`), raise `CORPUS_FLOOR` in
`corpus.mjs` to the new count, and run `node --test scripts/prove.test.mjs`, then the full prove. A hit is a false
positive to fix in the scanner, red test first, not a file to leave out. A fix that opens a gap adds the gap to
`KNOWN_MISSES`; a loader change that lets a phone shape through adds it to `PHONE_KNOWN_MISSES` and to the list
above. When a scanner change catches a known miss, or passes a known false alarm, its test goes red: move
the case to `positives()` or into `clean/`.

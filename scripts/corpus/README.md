# The owner-data corpus

Realistic files shaped like Joyisfree's own: stock and order exports, colourway lists, size charts, care labels,
captions, price lists, packing lists and pages written for Leif. `npm run prove`'s scanners must pass every file in
`clean/`: no secret-shaped text, and no terminal step on a page Leif reads.

Why it exists: on 9 Nov 2026 three independent verifiers in a row broke a fix to prove's scanners with files like
these, which the fixer's own tests never had (a stock CSV of colour and size words read as a seed phrase; "the choco
brown hoodie" read as a command). The files began as those verifiers' inputs, so a scanner change now meets the
owner's data before it meets a verifier.

Rules for every file here:
- Invented, never exported from a real shop or inbox. Product names (Harbour Hoodie, Ocean Tote, JIF- SKUs) are made
  up; none appears in the studio repository.
- Email addresses only at the reserved domains example.com, example.org, example.net or example.invalid. No person's
  name, handle, phone number or address.
- Text formats only: .csv, .tsv, .md, .txt, .json.
- A file that must be caught (a seed, a cookie, a command) never sits here as a file: it is built at runtime in a
  test, so the repository never holds secret-shaped text.

To add a file: put it in `clean/` with a name that says where it came from (`<round>-<what>.<ext>`), and run the
full prove. A hit is a false positive to fix in the scanner, not a file to leave out.

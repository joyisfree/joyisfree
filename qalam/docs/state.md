# Qalam: state (8 Nov 2026)

- **What it is:** a pen-first day. The habit lives on paper, and the `qalam` skill is a small coach for the bedtime
  brain dump, a photo of the page and the Friday review. It is generic on purpose: this repo is public, so it names
  no people, places or clients.
- **Done:**
  - the skill source `qalam/skill/qalam/`: SKILL.md and `references/sources.md`, with every ayah and hadith checked
    6 to 7 Nov 2026;
  - the guard `qalam/scripts/skill.test.mjs`, run by `npm test`;
  - the account zip, built with `npm run qalam:pack`.
- **Next (the owner):** upload `qalam/dist/qalam.zip` once. On claude.ai: Customize → Skills → + → Create skill →
  Upload a skill, with code execution and file creation switched on. Then check that /qalam appears in the phone app.
- **Next (Claude):** after any edit to the skill, run `npm test`, re-pack, and hand the owner the new zip.
- **Decisions:**
  - no extra agents (four seats inside the skill);
  - no automatic calendar writes;
  - no prayer times in the skill;
  - no printable card in v1.
- **Blocked:** nothing.

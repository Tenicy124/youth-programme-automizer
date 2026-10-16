# Youth Programme Studio

A Mac desktop app for planning and creating youth programmes. Everything is stored locally on your Mac, and Claude (Anthropic's AI) helps you brainstorm, draft full session plans and write documents.

## What it does

| Area | What you can do |
|---|---|
| **Library** | Store every programme you run: age group, format, duration, objectives, a session-by-session run-sheet, materials, budget, safeguarding notes, rating and reflections. Search by keyword (with synonyms, so "camping" finds outdoor programmes) and filter by age, format, status and theme. |
| **Discover & Ideate** | Fill in a brief (age group, interests, goals, constraints). *Search library* recommends the best-matching programmes you already have, with reasons (same age group, shared themes, highly rated). *Generate new ideas with AI* produces fresh concepts that build on what's in your library. One click turns an idea into a complete, saved draft plan. |
| **AI Studio** | Chat with Claude about ice-breakers, gaps in your offer, parent letters, inclusion ideas and more. It can see your library, and "Review & improve" from any programme opens a conversation focused on that programme. |
| **Templates** | Reusable documents (full plan, single session plan, funding proposal, risk assessment, evaluation are included). Write your own, or describe one and have AI draft it. `{{placeholders}}` such as `{{programme_title}}` fill in automatically, and *Complete with AI* writes the rest from the programme's details. |
| **Export** | Programmes and documents export to PDF or Markdown. The whole library exports/imports as a JSON file for backup or sharing with colleagues. |

The app starts with 14 sample programmes and 5 templates so you can try it straight away. Delete them whenever you like.

## Install on your Mac

You need Node.js once, to build the app.

1. Install the **LTS** version of Node.js from <https://nodejs.org>.
2. Download this `youth-programme-app` folder to your Mac (for example into `Downloads`).
3. Open **Terminal**, then run (adjust the path if you saved it elsewhere):

   ```bash
   cd ~/Downloads/youth-programme-app
   bash setup-mac.command
   ```

The script installs dependencies, builds **Youth Programme Studio.app**, copies it into `/Applications` and opens it. Afterwards you can launch it from Launchpad or Spotlight like any other app. It works on both Apple Silicon and Intel Macs.

Other commands, if you prefer:

```bash
npm install          # once
npm start            # run without installing
npm run dist:mac     # build a .dmg installer in dist/ (to share with colleagues)
npm test             # run the unit tests
```

A `.dmg` you share is not notarised by Apple, so on another Mac the first launch needs a right-click on the app and then **Open**.

## Turn on AI

1. Create an API key at <https://console.anthropic.com> (Settings → API Keys). API usage is billed by Anthropic to that account.
2. In the app, open **Settings**, paste the key and click **Save**, then **Test connection**.

The key is encrypted with your Mac's Keychain and is only sent to Anthropic's API. The default model is `claude-opus-5-5`; you can switch to `claude-sonnet-5-5` in Settings for lower cost. Everything except the AI features works without a key.

## Where your data lives

`~/Library/Application Support/Youth Programme Studio/library.json`. Settings → *Show in Finder* opens it. Use *Export library* for backups.

## Project layout

```
src/main/main.js       Electron main process: window, menus, IPC, file dialogs, PDF export
src/main/store.js      Local JSON database (atomic writes, import/export)
src/main/ai.js         Claude integration: ideas, full plans, templates, chat (streaming)
src/main/preload.js    Safe bridge between the UI and the main process
src/shared/search.js   Search + recommendation engine (TF-IDF with synonyms, rating/age boosts)
src/renderer/          The interface (plain HTML/CSS/JS, light and dark mode)
src/seed/              Sample programmes and templates loaded on first launch
test/                  Unit tests (node --test)
```

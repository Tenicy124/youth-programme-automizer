# Youth Programme Studio

A Mac desktop app for planning and creating youth programmes. Everything is stored locally on your Mac, and Claude (Anthropic's AI) helps you brainstorm, draft full session plans and write documents.

## What it does

| Page | What you can do |
|---|---|
| **Home** | See every programme at a glance (status, age group, format, last updated) with totals for ready, in planning and delivered, plus shortcuts to everything else. |
| **Create new** | A step-by-step form: Start → Basics → Goals & tags → Sessions → Resources & safety → Review & save. Start from scratch, from AI ideas (describe your group and get concepts, then one click drafts the full plan), from a copy of an existing programme, or with a template attached. Nothing is saved until the last step. |
| **Catalog** | Search by keyword (with synonyms, so "camping" finds outdoor programmes) with a dropdown of matching programmes as you type; press Esc or ✕ to leave the search. A Filters popup narrows by age, format, status and tag. Each programme has its own page with the full plan, similar programmes, export, duplicate and delete. |
| **Edit** | Every programme can be edited on its own page, split into tabs (Basics, Goals & tags, Sessions, Resources & safety, Documents, Status & notes), with a clear save bar so nothing changes until you click *Save changes*. |
| **Templates** | Reusable documents (full plan, single session plan, funding proposal, risk assessment, evaluation are included). Write your own, import one from text, or describe one and have AI draft it. `{{placeholders}}` such as `{{programme_title}}` fill in automatically, and *Complete with AI* writes the rest from the programme's details. |
| **Import** | Paste or load an existing programme (.txt/.md) and either import it as written or have AI organise it into sessions, objectives and the other fields; you review it before it's saved. Also imports templates from text and restores or shares library backup files. |
| **AI assistant** | Chat with Claude about ice-breakers, gaps in your offer, parent letters, inclusion ideas and more. It can see your catalog, and "Review & improve with AI" on any programme opens a conversation focused on it. |
| **Share** | Pick programmes (from the Catalog, a programme page, or File → Share Programmes) and save them as a `.ypcatalog` file to send by email, AirDrop or a shared drive. Colleagues double-click it (or use Import → Open a shared catalog), preview what's inside and choose what to add; programmes they already have are flagged so nothing is overwritten unless they tick it. Private notes and ratings are left out unless you include them. You can also save the selection as a printable catalog PDF for people without the app. |
| **Export** | Programmes and documents export to PDF or Markdown. |

The app starts with 14 sample programmes and 5 templates so you can try it straight away. Delete them whenever you like.

## Install on your Mac

1. Go to the [latest release](https://github.com/Tenicy124/youth-programme-automizer/releases/latest) and download the **.dmg** file.
2. Open it and drag **Youth Programme Studio** into **Applications**.
3. Open the app. The first time, macOS says it's from an unidentified developer: open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. You only do this once.

It runs on both Apple Silicon and Intel Macs.

### Building it yourself (optional)

Every push to `main` builds the app on a GitHub Mac runner and publishes it as the release for the version in `package.json` (bump the version to publish a new release). To build locally instead, install Node.js LTS and run:

```bash
bash setup-mac.command   # builds the app and copies it to /Applications
npm start                # or just run it without installing
npm test                 # unit tests
```

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

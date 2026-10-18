# Youth Programme Studio

A Mac desktop app for planning and creating youth programmes. Everything is stored locally on your Mac, and Claude (Anthropic's AI) helps you brainstorm, draft full session plans and write documents.

## What it does

| Page | What you can do |
|---|---|
| **Home** | A summary of your catalog: totals for ready, in planning and delivered, plus breakdowns by age group, format and most common tags. Click any number or bar to open the matching programmes in the Catalog. |
| **Create new** | The Youth Programme Planning Form, one step per section and box for box in the same order and wording: 1 Programme Overview, 1.2 Programme Logistics, 2 Core Youth Need Addressed, 3 Core Competencies Targeted, 4 Icebreaker Activity, 5 Main Activity / Programme Flow, 6 Mindfulness Infusion, 7 Risk Management, 8 Intended Outcomes, then Review & save (where you also add the catalog description and tags). Sections 3, 4 and 6 are marked Mandatory, every tick box is a clickable option (with Other where the form has it), and Risk Management is entirely click-and-select (choosing a risk adds its usual mitigations; emergency contacts come from your saved list). An **AI helper** panel sits beside the form. Start from scratch, from AI ideas, from a copy of an existing programme, or with a template attached. |
| **Catalog** | Search by keyword (with synonyms, so "camping" finds outdoor programmes) with a dropdown of matching programmes as you type; press Esc or ✕ to leave the search. A Filters popup narrows by age, format, status and tag. Each programme has its own page with the full plan, similar programmes, export, duplicate and delete. |
| **Edit** | Every programme can be edited on its own page, split into one tab per planning-form section plus Documents and Status & notes, with the AI helper alongside, with a clear save bar so nothing changes until you click *Save changes*. |
| **Templates** | Reusable documents (full plan, single session plan, funding proposal, risk assessment, evaluation are included). Write your own, import one from text, or describe one and have AI draft it. `{{placeholders}}` such as `{{programme_title}}` fill in automatically, and *Complete with AI* writes the rest from the programme's details. |
| **Import** | Paste or load an existing programme (.txt/.md) and either import it as written or have AI organise it into sessions, objectives and the other fields; you review it before it's saved. Also imports templates from text and restores or shares library backup files. |
| **Share** | Pick programmes (from the Catalog, a programme page, or File → Share Programmes) and save them as a `.ypcatalog` file to send by email, AirDrop or a shared drive. Colleagues double-click it (or use Import → Open a shared catalog), preview what's inside and choose what to add; programmes they already have are flagged so nothing is overwritten unless they tick it. Private notes and ratings are left out unless you include them. You can also save the selection as a printable catalog PDF for people without the app. |
| **Programme page & Export** | Each programme is shown section by section exactly like the planning form, with every tick box shown ticked or unticked. The PDF export prints it in the same layout. Programmes and documents also export to Markdown. |

The app comes with 12 Brahm Centre youth programmes (converted from the team's planning forms) and 5 templates. Updating from an older version adds these programmes to your existing catalog once (and refreshes any you haven't edited); anything you delete afterwards stays deleted. Programmes saved by older versions are moved onto the new form automatically: old age bands map to the closest new band and old safety notes stay visible under Safety until you move them into the pick-lists.

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

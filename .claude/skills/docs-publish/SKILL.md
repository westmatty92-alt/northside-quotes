---
name: docs-publish
description: bl-docs publishing — operator and company SOPs to the Notion 📚 Baseleap SOP Hub, client SOPs to the client's docs, the agent index to the hub. Diff against the last published version first; a page a person edited since is never overwritten (show the diff, ask). Create and update only inside the hub; never delete.
---

# Docs · Publishing

## 1. Where
- Kinds 1–3 → a child page of the **📚 Baseleap SOP Hub** in Notion (top level, next to Coding / App building). One page per SOP; the hub page lists them by kind.
- Kind 4 → the hub's "Agents" index page (`docs-index`).
- Kind 5 → the client's docs location named in the build plan. Never the Baseleap hub.

## 2. Before every update
1. Fetch the page. Compare it with the last version you published (kept in `docs/sops/.published/<slug>.md`).
2. **Same as last published** → update it with the new SOP and save the new copy to `.published/`.
3. **A person changed it** → don't write. Put the diff in your report and ask the orchestrator to bring it to Matthew: keep his wording, merge, or replace.

## 3. Rules
- Create and update pages only inside the hub (and pages you created). Search and read anywhere you're pointed to. Never delete or move pages.
- Never publish an SOP that fails `sop-check`, or with `⚠ unverified` steps, unless the step says so; then keep the markers visible.
- Notion-flavoured Markdown; keep headings and numbered steps; links stay links.

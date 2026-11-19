# User Stories: <Product name>

Personas: <Persona A>, <Persona B> (defined in `docs/PRD.md` → Overview)
Tags: `[happy]` main path · `[edge]` boundary or unusual input · `[error]` failure and recovery · `[nfr]` performance, accessibility, security, audit

---

### US-001: <short title>
Priority: Must · Persona: <Persona A> · Serves FR: FR-1

As a <persona>, I want <capability>, so that <outcome>.

**Acceptance criteria**
- **AC-001.1** [happy] Given <concrete context>, when <action>, then <observable result>.
- **AC-001.2** [edge] Given <concrete context>, when <action>, then <observable result>.
- **AC-001.3** [error] Given <failure context>, when <action>, then <what the user sees and what happens to their data>.

**Notes:** <assumptions, rules, data details — or "none">
**Out of scope:** <what this story deliberately doesn't do — or "none">

---

### US-002: <short title>
Priority: Should · Persona: <Persona B> · Serves FR: FR-2

As a <persona>, I want <capability>, so that <outcome>.

**Acceptance criteria**
- **AC-002.1** [happy] Given <…>, when <…>, then <…>.
- **AC-002.2** [error] Given <…>, when <…>, then <…>.

**Notes:** none
**Out of scope:** none

---

## Suggested build order
1. US-001 — thinnest end-to-end slice; proves the path
2. US-002 — <why next>

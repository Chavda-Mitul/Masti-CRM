# Domain Docs

How the engineering skills should read this repo's domain documentation.

## Before exploring, read these

- **`CLAUDE.md`**: the non-negotiable rules and the backend route conventions.
- **`PROJECT_KNOWLEDGE.md`**: the full project knowledge. Read the section that covers the feature. §17 lists where sources disagree and §18 lists open questions; also check `QUESTIONS_TO_ASK.md`.
- **`CONTEXT.md`** at the repo root, if it exists: the glossary.
- **`docs/decisions/`**: this repo's ADRs (`0001-auth-sessions.md` …). Read the ones that touch the area you're working in.

`Masti-CRM-Handover/` is the read-only source pack (requirements, contract, approved demo). Never edit it.

If `CONTEXT.md` doesn't exist, **proceed silently**. Don't flag its absence or suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved.

## ADR location override

Where a skill says `docs/adr/`, use **`docs/decisions/`** instead. Don't create `docs/adr/`. New records continue the existing numbering (the next one is `0006-…`) and follow the existing records' format: a title of `# NNNN · Title`, then Status / Date / Scope bullets, then the decision with any amendments.

## Layout (single-context)

```
/
├── CLAUDE.md
├── PROJECT_KNOWLEDGE.md
├── CONTEXT.md            ← created lazily
├── docs/decisions/       ← ADRs
│   ├── 0001-auth-sessions.md
│   └── 0002-user-types.md
├── Backend/
└── Frontend/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts a record in `docs/decisions/`, surface it explicitly rather than silently overriding:

> _Contradicts 0005 (system masters), but worth reopening because…_

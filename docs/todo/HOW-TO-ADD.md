# How To Add A TODO Doc

Read this before creating a new file under `docs/todo/`.

## When To Add A Doc

Add a TODO doc when the work is one of:

- **TODO** - designed but not started
- **WIP** - partially shipped, more phases pending
- **PARKED** - designed and deferred until a clear trigger
- **PHASED** - multi-phase plan; some phases shipped, more to do

Do not add a TODO doc for:

- Shipped features with no follow-up work; write normal docs under `docs/`
- One-shot bugs or refactors that fit in a single PR
- Vendor or competitor research; use `docs/feature-research/`
- Secrets, credentials, or local session state

If another agent needs to pick the work up cold weeks later, write the doc.

## Template

```markdown
# <Title>

**Status:** <TODO | WIP | PARKED | PHASED (...)>
**Owner:** <name/team>
**Last updated:** YYYY-MM-DD
**Related:** <paths, package names, config files, issue IDs>

---

## Why This Exists

<2-4 sentences describing the problem, the symptom, and why it matters.>

## Phase 1 TODO - <Name>

<Scope, decisions, and constraints.>

## Open Questions

- <Question>

## Reference

- Code: `src/...`
- Config: `...`
- Docs: `docs/...`
```

## Updating Status

When a phase ships:

1. Update the doc's **Status** line.
2. Mark the shipped phase inline.
3. Add commit SHA plus subject.
4. Update `docs/todo/INDEX.md`.
5. Update the **Last touched** date.

When a doc is fully complete, move durable user/developer guidance into a normal `docs/*.md` file and remove the item from this index.

## Common Mistakes

- Do not duplicate large code blocks or schemas; link to owning files.
- Do not mix active work with speculative ideas without labeling the speculative part.
- Do not commit local profile state, login state, or API keys.
- Do not treat a planning doc as proof that code already exists.

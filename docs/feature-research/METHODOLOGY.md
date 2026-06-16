# Feature Research Methodology

Use this format for competitor, adjacent-product, and protocol research that feeds the NightSquawk desktop roadmap.

## Folder Layout Per Topic

```text
feature-research/
  <topic>/
    <topic>.md
    pictures/
      SOURCES.md
      <descriptive-screenshot>.png
```

- One folder per product, protocol, or focused comparison.
- Use kebab-case folder names.
- `<topic>.md` is the source of truth for the research.
- `pictures/` is optional for protocol/config research and recommended for UI/product research.
- If screenshots are used, add `pictures/SOURCES.md` with source URL and capture date.

## Markdown Shape

Every research file should follow this structure:

```markdown
> Status: [DONE] = this checkout already has it | [PLANNED] = on roadmap | [GAP] = not planned or not available

# <Topic> - Feature Map

<Dense opening paragraph: what this is, who ships it, deployment model, pricing/licensing if relevant, and why it matters to a NightSquawk desktop Matrix client.>

## <Capability Area>

- [DONE] <Feature> - point to the local file/config that proves it exists.
- [PLANNED] <Feature> - point to `docs/todo/...` or explain the planned phase.
- [GAP] <Feature> - state whether this is intentionally out of scope or a real product gap.
```

## Rules

1. Put the status legend blockquote at the top, verbatim.
2. Use one H1 only: `# <Topic> - Feature Map`.
3. Group by buyer/operator capability, not marketing page order.
4. Every bullet starts with `[DONE]`, `[PLANNED]`, or `[GAP]`.
5. Be honest: `[DONE]` means it is working in this checkout or documented in an owning config, not merely possible.
6. Link local evidence with repo-relative paths.
7. Keep credentials, tokens, private screenshots, and session data out of research docs.
8. For current product claims, use fresh source research and include source links.

## Good Research Targets

- Matrix client defaults and custom homeserver UX
- Branding and app identity in Element Desktop / Electron Builder
- MatrixRTC and Element Call desktop behavior
- Integration manager configuration and widget discovery
- Installer signing, auto-update, and release channel design
- Other Matrix clients' differentiators worth copying or explicitly rejecting

## Before Committing

- [ ] The file uses the required status legend.
- [ ] Every bullet is tagged.
- [ ] Local claims link to local files.
- [ ] External claims have source links.
- [ ] No credentials, private profile data, or private screenshots are included.

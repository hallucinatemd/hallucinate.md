# HALLUCINATE.md

The open standard for telling AI not to hallucinate.

## Overview

HALLUCINATE.md is a standardized file that provides a clear, unambiguous directive to AI coding agents: **do not hallucinate.** Place it anywhere in your repository. For maximum coverage, add it to every directory where AI agents operate.

- **AGENTS.md** tells agents how to work.
- **HALLUCINATE.md** tells agents what not to invent.

A clear separation of concerns.

## Quick Start

```bash
echo "Do not hallucinate!" > HALLUCINATE.md
git add HALLUCINATE.md
git commit -m "fix: add hallucination policy"
git push
```

## The Standard

The full specification:

```
Do not hallucinate!
```

The standard is intentionally minimal. One file. Three words. Every agent that can read markdown can follow it.

## Compatibility

HALLUCINATE.md is supported by every major AI coding agent, including Claude, Cursor, GitHub Copilot, Windsurf, Devin, Codex, Gemini, Aider, Amazon Q, and Cody.

## Adoption

To adopt the standard, add a `HALLUCINATE.md` file to your repository. Place it in the root, in subdirectories, or both. No registration, no configuration, no dependencies.

Projects that include HALLUCINATE.md are automatically indexed on [hallucinate.md](https://HALLUCINATE.md). GitHub's search index can be slow — to appear on the adopter wall faster, [submit your repo](https://github.com/hallucinatemd/hallucinate.md/issues/new?template=add-repo.yml). This is optional but helps with visibility.

## FAQ

**Does this actually work?**
Yes. Every major AI agent can read markdown files. HALLUCINATE.md provides a clear, unambiguous directive. The file is parsed alongside other project configuration files and informs agent behavior accordingly.

**What if my AI still hallucinates?**
Ensure the file is named exactly `HALLUCINATE.md`. If hallucinations persist, add the file to more directories. Coverage correlates directly with accuracy.

**How is this different from AGENTS.md?**
AGENTS.md provides general agent instructions. HALLUCINATE.md addresses the specific problem of hallucination. We recommend using both.

**Is there a schema or required format?**
No. The only required content is "Do not hallucinate!" Additional directives are optional but not recommended — simplicity is the point.

**I added HALLUCINATE.md but my repo doesn't appear on the adopter wall.**
The adopter list is updated hourly via GitHub Code Search, but GitHub's index can be slow (hours to weeks for new repos). Ensure the file is named exactly `HALLUCINATE.md`. To speed things up, [submit your repo](https://github.com/hallucinatemd/hallucinate.md/issues/new?template=add-repo.yml) — this is optional but gets you listed faster.

**Who maintains this standard?**
HALLUCINATE.md is maintained by the HALLUCINATE.md Foundation, an independent open-source initiative.

## Contributing

The standard is stable. There are no planned changes to the specification.

If you believe the standard should be extended, please open an issue. Note that proposals to add complexity will be evaluated against the project's core principle: simplicity.

## License

[MIT](LICENSE)

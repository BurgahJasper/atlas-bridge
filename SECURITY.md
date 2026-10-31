# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report privately through GitHub's *Report a vulnerability* button on this repository (Security tab → Advisories). Include steps to reproduce and the affected version or commit.

We aim to acknowledge reports within 5 working days.

## Scope

In scope:

- URL handling and server-side fetches (SSRF, host allowlist, path traversal)
- API routes that accept untrusted input (body size, schema validation)
- Prompt injection from repository text that changes stored results or leaks secrets
- Anything that writes to GitHub without the explicit consent flow

Out of scope:

- Findings that require a maintainer's own token to be exposed
- Rate-limit exhaustion on public GitHub endpoints

## Design notes

- Tokens (`GITHUB_TOKEN`, `GEMINI_API_KEY`, `GITHUB_WRITE_TOKEN`) are read on the server only and are not sent to the browser or into model prompts.
- Repository text is treated as untrusted data in every model prompt.
- No untrusted repository code is executed. Mission checks are static.

# Contributing to Atlas Bridge

Thank you for helping. The full guide, including the package ownership map and the invariants that must not break, is in [docs/contributing.md](docs/contributing.md).

Quick start:

```bash
npm install
npm test              # unit and integration tests
npm run typecheck
npm run build
npm run start         # then, in another terminal: npm run smoke
```

Before opening a pull request:

- Keep changes scoped to one package or concern.
- Add or update tests for any pure logic you change.
- Do not add model calls to deterministic scoring (missions are scored by code only).
- Do not bypass the consent gate for GitHub writes.
- Label offline or fallback output as such. Never present it as live inference.

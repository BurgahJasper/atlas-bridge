# Third-party notices

Atlas Bridge's own code is released under the MIT license (see [LICENSE](LICENSE)). Its dependencies remain under their own licenses. Generated explanations and translations do not change the licensing of any upstream repository they describe.

Direct runtime dependencies include Next.js, React, React Flow (`@xyflow/react`), Zod, Express, `pg`, and the Google GenAI SDK (`@google/genai`). Test and build tooling includes Vitest, TypeScript and Tailwind CSS.

To produce a complete list with license types for the exact versions installed:

```bash
npx license-checker --production --summary
```

The curated demo fixture (`packages/pipeline/src/fixtures/octokit-request-js.json`) contains public source text and documentation from [octokit/request.js](https://github.com/octokit/request.js), which is MIT-licensed. It is included only to make the demo work offline. Attribution belongs to its authors.

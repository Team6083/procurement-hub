# Guide for coding agents

Development rules live in [`CONTRIBUTING.md`](CONTRIBUTING.md): the checks CI runs, the API contract rules, the e2e conventions, the web UI package rules and the gotchas. Read it before changing code. The README's [Testing](README.md#testing) section shows how to run the tests.

- Local files that are not tracked (such as a `spec.md` or `HANDOFF.md` in your checkout) are not part of the repository: never commit them and do not copy their content into tracked files. Put lasting rules in `CONTRIBUTING.md`. Hide personal or temporary files with `.git/info/exclude`, not with `.gitignore`, which lists only what the project itself generates.
- Nothing organization-specific goes into the repository (see "Repository rules" in `CONTRIBUTING.md`).
- Change `api/openapi.yaml` first, then the handlers, `npm run gen:api` and the HTTP tests, all in the same change.

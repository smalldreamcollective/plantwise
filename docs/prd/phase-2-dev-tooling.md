# PRD — Phase 2: Dev Tooling

## Status
Complete

## Goal
Establish a consistent, automated code-quality pipeline so that all contributors (human and AI) produce clean, well-tested code from the start.

## Background
Before adding real features, the project needs linting, formatting, pre-commit enforcement, and a test runner. Phase 2 adds all of this without touching product functionality.

## Scope

### What's included
- **ESLint** (flat config, `eslint.config.mjs`) with `typescript-eslint` and `eslint-config-prettier`
- **Prettier** (`.prettierrc`) for consistent formatting
- **Husky v9** + **lint-staged** — pre-commit hook runs `eslint --fix` + `prettier --write` on staged `.ts` files
- **Vitest** — unit test runner with `@vitest/coverage-v8`
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs `lint`, `format:check`, and `test` on every push/PR to `main`
- `npm run` scripts: `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:watch`, `test:coverage`

### What's excluded
- Type-checking in CI (too slow due to LangGraph type complexity; run manually with `npm run typecheck`)
- End-to-end tests (deferred until AI calls are testable with mocked API keys)

## Key decisions
- **tsup over tsc for builds** — LangGraph/LangChain type generics cause tsc to OOM. tsup (esbuild-based) is used for `npm run build`; tsc is reserved for type-checking only.
- **Flat ESLint config** — avoids legacy `.eslintrc` format deprecation issues with ESLint 9+

## Success criteria
- `npm run lint` passes on all source files
- `npm run format:check` passes on all source files
- `npm run test` passes (initial DB layer tests)
- Pre-commit hook blocks non-linted/non-formatted code
- CI pipeline runs and passes on GitHub

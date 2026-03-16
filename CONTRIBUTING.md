# Contributing to ClawSwarm

Thank you for your interest in contributing to ClawSwarm! We welcome contributions of all kinds — bug fixes, new features, documentation improvements, and more.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+ (for workspaces support)
- TypeScript knowledge

### Setup

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/clawswarm.git
   cd clawswarm
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Build** all packages:
   ```bash
   npm run build
   ```
5. **Run tests**:
   ```bash
   npm test
   ```

## Workflow

### Branching

- `main` — stable, production-ready code
- `dev` — active development (base your branches off this)
- Feature branches: `feat/<description>` (e.g., `feat/add-memory-agent`)
- Bug fix branches: `fix/<description>` (e.g., `fix/chief-score-calculation`)
- Docs branches: `docs/<description>`

### Making Changes

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Make your changes with clear, focused commits
3. Add or update tests as appropriate
4. Update documentation if you're changing public APIs
5. Run the full test suite before pushing

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add ResearchClaw memory support
fix: correct chief review score threshold
docs: update getting-started guide
chore: upgrade TypeScript to 5.4
refactor: simplify task lifecycle state machine
test: add coverage for goal decomposition
```

### Pull Requests

1. Push your branch and open a PR against `main`
2. Fill out the PR template completely
3. Link any related issues (e.g., `Closes #42`)
4. Request a review from a maintainer
5. Address review feedback promptly

PRs should:
- Be focused on a single change
- Include tests for new functionality
- Not break existing tests
- Update CHANGELOG.md if applicable

## Code Style

### TypeScript

- Strict mode is enabled — no `any` without justification
- Prefer `interface` over `type` for object shapes
- Use JSDoc comments for all public APIs
- Name things clearly — avoid abbreviations

### Formatting

We use [Prettier](https://prettier.io/) for formatting and [ESLint](https://eslint.org/) for linting:

```bash
npm run lint        # Check for lint errors
npm run lint:fix    # Auto-fix lint errors
npm run format      # Format with Prettier
```

### Testing

- Tests live alongside source files in `__tests__/` directories
- Use [Vitest](https://vitest.dev/) for unit tests
- Aim for meaningful coverage, not 100% line coverage
- Test behavior, not implementation details

## Package Structure

ClawSwarm is a monorepo with npm workspaces:

```
packages/
  core/     — Core agent framework (@clawswarm/core)
  bridge/   — Bridge service (@clawswarm/bridge)
  cli/      — CLI tool (@clawswarm/cli)
```

Changes to `core` may require updates to `bridge` and `cli`. Test across all packages.

## Reporting Issues

### Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- ClawSwarm version
- Node.js version
- Minimal reproduction case
- Expected vs. actual behavior

### Feature Requests

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe:
- The problem you're trying to solve
- Your proposed solution
- Alternatives you've considered

## Community

- Be kind and respectful
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- Questions? Open a [Discussion](https://github.com/trietphan/clawswarm/discussions)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

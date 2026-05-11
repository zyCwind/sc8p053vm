# SC8P053VM - Agent Guide

## Project Overview

SC8P053VM is a high-fidelity virtual machine simulator for the SC8P053 microcontroller, designed as an AI-driven embedded development platform. It provides:

- **Complete instruction set simulation** for SC8P053 MCU
- **Precise peripheral emulation** (timers, PWM, comparators, I/O ports)
- **C compiler** that translates C code to SC8P053 machine code
- **Interactive debugger** with real-time register/memory visualization
- **AI-assisted optimization** for embedded code

**Core positioning**: This is NOT a general-purpose simulator. It's a specialized tool for SC8P053 development and AI-driven hardware code optimization.

## Quick Start

### For New Agents

1. **Read this document first** - Understand project structure and conventions
2. **Check docs/INDEX.md** - Navigate all available documentation
3. **Review docs/ONBOARDING.md** - Setup environment and learn workflow
4. **Explore docs/CODE_STRUCTURE.md** - Understand code modules and APIs

### Essential Commands

```bash
# Build the project
npm run build

# Run development server (frontend debugger)
npm run dev

# Install dependencies
npm install

# Lint code quality and style
npm run lint          # Check all TypeScript files
npm run lint:src      # Check src/ directory only
npm run lint:example  # Check example/ directory only
npm run lint:fix      # Auto-fix fixable issues
npm run format        # Format all supported files
```

## Development Principles

### Document-Driven Development

This project follows **document-driven development**:

1. **Design first** - Write specs before implementation
2. **Plans second** - Create detailed implementation plans
3. **Code last** - Execute plans with verification

All major changes must follow: `brainstorming → spec → plan → implementation`

### Test-Driven Development (TDD)

**MANDATORY**: Always write tests before implementation code.

1. Write failing test case
2. Write minimal code to pass test
3. Refactor while keeping tests green
4. Never skip testing

### Skills Usage

This project uses AI agent skills to enforce workflows and best practices.

**Common skills:**
- **brainstorming** - Use BEFORE any creative work (features, components, modifications)
- **writing-plans** - Use after design approval to create implementation plans
- **test-driven-development** - Use when implementing features or bugfixes
- **systematic-debugging** - Use when encountering bugs or unexpected behavior
- **verification-before-completion** - Use before claiming work is complete

**CRITICAL**: Invoke appropriate skills based on task type. Don't skip skill usage.

Skills are installed in your agent's skill directory and will be available automatically.

### Before Starting Implementation

**MANDATORY CHECK**: Verify documentation completeness before writing ANY code!

For **Level 1** (Major Architecture) and **Level 2** (Feature Development) tasks:
- [ ] Design spec exists in `docs/superpowers/specs/`
- [ ] Implementation plan exists in `docs/superpowers/plans/`
- [ ] Both documents have been reviewed/approved

**DO NOT start coding until these documents are complete!**

**Use the `writing-plans` skill** after spec approval to create the implementation plan.

For **Level 3** (Tool Configuration) and **Level 4** (Simple Fixes):
- Just ensure relevant existing docs are updated
- No spec/plan required

## Documentation Requirements by Task Type

Not all tasks require the same level of documentation. Use this guide to determine what documents to create:

### Level 1: Major Architecture Changes
**Examples**: New subsystem, major refactoring, technology migration, project-wide decisions

**Required Documents**:
- ✅ **ADR** (`docs/decisions/`) - Document the architectural decision
- ✅ **Design Spec** (`docs/superpowers/specs/`) - Detailed design document
- ✅ **Implementation Plan** (`docs/superpowers/plans/`) - Step-by-step implementation plan

**When to use**: Changes that affect multiple modules, introduce new paradigms, or have long-term impact on the project.

**Example**: Adding document-driven development infrastructure (ADR 001)

---

### Level 2: Feature Development
**Examples**: New VM instruction, compiler feature, UI component, significant functionality

**Required Documents**:
- ✅ **Design Spec** (`docs/superpowers/specs/`) - Design document
- ✅ **Implementation Plan** (`docs/superpowers/plans/`) - Implementation plan

**Optional**:
- ⚠️ ADR (only if it involves a significant design decision)

**When to use**: Adding substantial new features that require design思考 and planning.

**Example**: Adding comprehensive error detection with AST analysis

---

### Level 3: Tool Configuration / Infrastructure Improvements
**Examples**: Add linting, update dependencies, configure CI/CD, add build tools

**Required Documents**:
- ✅ **Update existing docs** - Update relevant documentation (e.g., AGENTS.md, LINT_GUIDE.md)
- ⚠️ **ADR (optional)** - Only if it's a significant decision worth recording

**NOT Required**:
- ❌ No spec needed
- ❌ No plan needed

**When to use**: Tool chain improvements, configuration changes, or infrastructure updates that are relatively straightforward.

**Example**: Adding ESLint + Prettier for code quality (created ADR 002, but NO spec/plan needed)

**Note**: If you already created spec/plan for this type of work, that's acceptable but not required for future similar tasks.

---

### Level 4: Simple Bug Fixes / Small Changes
**Examples**: Fix typo, adjust styling, minor logic fix, small refactoring

**Required Documents**:
- ✅ **No new documentation needed**
- Just ensure code is clear, tested, and commit message is descriptive

**When to use**: Minor fixes, small improvements, or changes that don't affect architecture or add significant features.

**Example**: Fixing a bug in register display, adjusting CSS spacing

---

### Decision Flowchart

```
Is this a major architecture change?
├─ YES → Level 1 (ADR + Spec + Plan)
└─ NO
   ├─ Is this a new feature or significant functionality?
   │  ├─ YES → Level 2 (Spec + Plan)
   │  └─ NO
   │     ├─ Is this tool configuration or infrastructure?
   │     │  ├─ YES → Level 3 (Update docs, ADR optional)
   │     │  └─ NO → Level 4 (No new docs needed)
```

**Key Principle**: Documentation should add value, not create bureaucracy. When in doubt, err on the side of more documentation for complex changes, less for simple ones.

## Code Structure Overview

```
src/
├── vm.ts          - VM core (instruction execution, hardware simulation)
├── cc.ts          - C compiler (C → SC8P053 machine code)
├── asmc.ts        - Assembler (assembly code processing)
└── index.ts       - Module exports

example/
└── src/
    └── index.tsx  - React frontend debugger UI
```

**See docs/CODE_STRUCTURE.md for complete module documentation.**

## Documentation Navigation

### Entry Points

- **docs/INDEX.md** - Complete documentation map
- **docs/ONBOARDING.md** - Getting started guide
- **docs/WORKFLOW.md** - Development workflow (TDD process)
- **docs/COMPONENTS.md** - Reusable components and APIs

### Design & Planning

- **docs/superpowers/specs/** - Feature design documents
- **docs/superpowers/plans/** - Implementation plans
- **docs/decisions/** - Architecture decision records (ADRs)

## Key Constraints

### What NOT to Do

❌ **Don't implement without design** - Always create spec first for non-trivial changes
❌ **Don't skip tests** - TDD is mandatory, not optional
❌ **Don't reinvent wheels** - Check docs/COMPONENTS.md for existing utilities
❌ **Don't modify without understanding** - Read relevant docs before changing code
❌ **Don't commit unverified code** - Run tests and verify before committing

### What TO Do

✅ **Do read docs first** - Understand context before making changes
✅ **Do use skills** - Follow established workflows via skills
✅ **Do write specs** - Document design decisions for future reference
✅ **Do write tests** - Ensure correctness and prevent regressions
✅ **Do update docs** - Keep documentation synchronized with code changes

## Development Tools & Verification

### Code Quality: ESLint + Prettier

This project uses **ESLint** and **Prettier** to enforce code quality and style consistency.

**Configuration files:**
- `.eslintrc.js` - Root ESLint config (general rules)
- `.prettierrc.js` - Prettier formatting config
- `src/.eslintrc.js` - src/ specific rules (Node.js/library code)
- `example/.eslintrc.js` - example/ specific rules (React/Web code)
- `.eslintignore` - Files to exclude from linting

**Code style standards:**
- 4-space indentation
- Single quotes
- Semicolons required
- Max line length: 100 characters
- Trailing commas

**For new agents:**
- Run `npm run lint` before committing to ensure code quality
- Use `npm run lint:fix` to auto-fix formatting issues
- Check `docs/LINT_GUIDE.md` for detailed usage instructions
- IDE integration recommended (install ESLint and Prettier plugins)

### Using LSP (Language Server Protocol)

**IMPORTANT**: Your IDE has TypeScript LSP built-in!

**Before running build commands:**
1. Check your IDE's Problems panel for TypeScript errors
2. LSP shows errors inline as you type
3. Most syntax and type errors are caught by LSP immediately
4. Use build commands only for final verification before commit

**When to use build commands:**
- Final check before committing
- When LSP is not available or not working
- To verify the build process works
- For CI/CD pipelines

**DO NOT:**
- Run `npm run build` after every small change (use LSP instead)
- Use `npm run build` to check example/ files (use `npm run dev`)
- Ignore LSP errors and try to build anyway

### Build Commands by Directory

| Directory | Command | Purpose |
|-----------|---------|----------|
| `src/` | `npm run build` | Compile TypeScript library |
| `example/` | `npm run dev` | Start webpack dev server |

**Remember:**
- `npm run build` ONLY compiles src/ directory
- `npm run dev` compiles example/ with hot reload
- They use different build systems (tsc vs webpack)

### Testing with Jest

This project uses **Jest** for automated testing following TDD principles.

**Test structure:**
- `src/__tests__/*.test.ts` - Backend unit tests (compiler, VM, assembler)
- `example/src/__tests__/*.test.tsx` - Frontend React component tests

**Running tests:**
```bash
npm test               # Run backend tests only
npm run test:example   # Run frontend tests only
```

**TDD workflow:**
1. Write failing test case first
2. Write minimal code to pass test
3. Refactor while keeping tests green
4. Never skip testing

**For new agents:**
- Always write tests before implementation (TDD is MANDATORY)
- Run `npm test` before committing to ensure all tests pass
- See docs/WORKFLOW.md for detailed TDD process

---

## Git Commit Standards

### Commit Message Format

Follow **Conventional Commits** format:

```
type(scope): subject

body (optional)

footer (optional)
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only changes
- `style`: Formatting (no code logic change)
- `refactor`: Code restructuring (no feature change)
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, config, etc.)

### Examples from Project History

✅ **Good commits (with detailed body):**
```markdown
feat: add comprehensive error detection with AST, control flow, and type checking

- Implement AST error detection: validate syntax tree for ERROR nodes and report precise locations
- Add control flow analysis: build CFG to detect unreachable code and verify all paths return in non-void functions
- Introduce type checking: traverse AST to validate type consistency across expressions and statements
- Refactor type representation with TypeInfo interface to support CFG analysis
- Enhance interrupt handling: simplify triggerInterrupt by removing unused interrupt name parameter
- Clean up PWM module: remove unused clock division calculations
- Add comprehensive test suite: 800+ test cases in cc-test.js covering compiler edge cases
- Document compiler behavior: detailed analysis of bugs and fixes in cc-test.md based on SC8P053 manual
- Rename FunctionMacro to FnMacro for naming consistency
- Optimize tokenizer: remove unnecessary lineNo parameter from scanString/scanChar
- Bump version to 1.0.5
```

```markdown
feat: migrate example to React and enhance compiler with test suite

- Refactor example frontend from vanilla TypeScript to React with hooks
- Add syntax highlighting for C code using highlight.js
- Implement comprehensive test framework in cc-test.js (2800+ test cases)
- Document compiler bugs and fixes in cc-test.md based on SC8P053 manual
- Improve Preprocessor: fix conditional compilation evaluation order
- Export Sym and FnRange interfaces for external access
- Rename VM stackPtr to sp for consistency
- Update dependencies: add React 18, update TypeScript to 5.9.2
- Fix module resolution for web-tree-sitter in Node.js vs browser environments
- Add keyboard shortcuts for debugger controls (F5-F10)
- Bump version to 1.0.4
```

```markdown
chore: update project version and fix TypeScript module resolution

- Bump version to 1.0.1 in package.json and package-lock.json
- Configure example/tsconfig.json with ESNext module and bundler resolution
- Enable proper IDE support for sc8p053vm module imports
- Align TypeScript configuration with modern bundler-based workflows
```

❌ **Bad commits:**
```
1                    # Too vague, no type, no description
fix bug              # No scope, no detail about what bug
update code          # What was updated? Why?
```

### Scope Guidelines

Use scope to indicate which part of the codebase changed:
- `(vm)` - Virtual machine core
- `(compiler)` or `(cc)` - C compiler
- `(assembler)` or `(asmc)` - Assembler
- `(example)` - Frontend debugger
- `(docs)` - Documentation

### Subject Line Rules

- Use imperative mood ("add" not "added" or "adds")
- No period at the end
- Keep under 72 characters
- Be specific about what changed

### Body (Required for Non-Trivial Changes)

**Format**: Use bullet list with `- ` prefix for each change

**Important formatting rules:**
- **NO blank lines between bullet points** - keep them compact
- One bullet point per line
- No extra spacing or indentation beyond the `- ` prefix

**What to include:**
- List ALL significant changes made in the commit
- Start each bullet with action verb (Implement, Add, Fix, Update, Remove, etc.)
- Be specific about what was changed and why
- Include version bumps **ONLY when releasing a new version**
- Reference related files or test cases

**Example structure:**
```markdown
feat: brief summary of main change

- Implement feature X: describe what and how
- Add support for Y: explain the approach
- Fix issue Z: describe the problem and solution
- Update documentation: mention what docs were updated
- Refactor module A: explain the improvement
```

**Note**: 
- Keep bullet points compact with NO blank lines between them
- Only include "Bump version to X.Y.Z" when you are actually releasing a new version and have updated package.json.

**For complex changes, add more context:**
- Explain WHY the change was made
- Describe the approach taken
- Note any breaking changes
- Reference issues: `Refs: #123`

### Complete Example

```markdown
feat(compiler): add array bounds checking

- Implement runtime bounds checking for array access operations
- Add AST validation in semantic analysis phase to detect out-of-bounds indices
- Throw RangeError with detailed message when index is invalid
- Update type checking to verify array index expressions are numeric
- Add 50+ test cases in cc-test.js covering edge cases (negative indices, large indices)
- Document bounds checking behavior in docs/COMPONENTS.md

Refs: #45
```

**Key points:**
- Subject line is concise (< 72 chars)
- Body lists ALL changes with bullet points
- **NO blank lines between bullets** - keep compact
- Each bullet starts with action verb
- Specific about what was done
- Mentions tests and documentation
- **Does NOT include version bump** (unless actually releasing)
- References related issue

### Commit Granularity

**Group related changes into logical commits.**

Each commit should represent a **complete, working unit of change** that can be understood independently.

#### ✅ Good Practice - Logical Grouping

**Example 1: Infrastructure setup (all config together)**
```markdown
chore: setup vitest testing infrastructure

- Install vitest and testing dependencies
- Create root vitest.config.ts for src/ tests
- Create example/vitest.config.ts for frontend tests
- Add test scripts to package.json
```

**Example 2: Feature implementation (all tests together)**
```markdown
test: migrate compiler tests to Vitest framework

- Create src/__tests__/cc.test.ts with helper functions
- Migrate basic syntax tests (arithmetic, bitwise operations)
- Migrate advanced feature tests (functions, pointers)
- Migrate error handling tests
- Exclude legacy cc-test.js from vitest
```

**Example 3: Documentation update (all docs together)**
```markdown
docs: add TDD guidelines to project documentation

- Add TDD section to AGENTS.md with usage examples
- Update WORKFLOW.md with test commands
- Update INDEX.md with testing references
```

#### ❌ Bad Practice - Too Granular

**Don't do this:**
```bash
# One commit per file - too fragmented!
git commit -m "chore: add vitest.config.ts"
git commit -m "chore: add example/vitest.config.ts"
git commit -m "chore: update package.json scripts"
git commit -m "test: add first test case"
git commit -m "test: add second test case"
```

**Why it's bad:**
- Commit history becomes cluttered with tiny changes
- Individual commits lack semantic meaning
- Hard to understand the complete feature from git log
- Difficult to revert logically (need multiple reverts)

#### Decision Rule

**Ask yourself**: "If I revert this commit, will the feature still work?"

- **YES** → The commit is too small, merge with related changes
- **NO** → Good granularity, this is a logical unit

**Rule of thumb**: If two changes are needed together for the feature to work, they should be in the same commit.

### Before Committing Checklist

- [ ] Code follows style guidelines (run `npm run lint`)
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Commit message follows conventional format
- [ ] No debug code left in (console.log, etc.)
- [ ] Branch is up to date with main
- [ ] **Version bump ONLY if releasing new version** (check package.json)

## Completing a Task

After implementing and testing your changes, you MUST complete these steps:

### 1. Update Documentation

If your changes affect:
- **Public APIs** → Update `docs/COMPONENTS.md`
- **Architecture** → Update `docs/CODE_STRUCTURE.md`
- **Setup process** → Update `docs/ONBOARDING.md`
- **Workflows** → Update `docs/WORKFLOW.md`
- **Design decisions** → Add ADR in `docs/decisions/`

### 2. Run Code Quality Checks

```bash
npm run lint          # Check code quality
npm run lint:fix      # Auto-fix issues if any
```

Fix any linting errors before proceeding.

### 3. Verify Build

**For src/ changes:**
```bash
npm run build
```

**For example/ changes:**
```bash
npm run dev           # Check for webpack errors
```

### 4. Commit Changes

Follow the commit message format from the "Git Commit Standards" section below.

**Example:**
```bash
git add .
git commit -m "feat(example): add compiler error display

- Implement error state management in App component
- Add error message display in bottom status bar
- Clear errors on successful compilation
- Style error messages to match existing UI
"
git push
```

### 5. Final Verification

Use the `verification-before-completion` skill to ensure:
- All tests pass
- Code follows style guidelines
- Documentation is updated
- Commit message is correct
- No debug code left in

---

## Project Status

**Current version**: 1.0.5
**Completion level**: High (core VM, compiler, debugger implemented)
**Focus area**: Documentation infrastructure, quality improvements, feature enhancements

## Documentation Guidelines

### What Belongs in docs/

**✅ DO include:**
- Architecture and design decisions (ADRs)
- API references and component catalogs
- Development workflows and processes
- Onboarding guides for new developers/agents
- Feature design specs (in superpowers/specs/)
- Implementation plans (in superpowers/plans/)
- Technical reference material

**❌ DO NOT include:**
- Work session summaries or progress reports
- Temporary notes or scratch pads
- Personal reflections or learning journals
- Duplicate information already in git history
- Implementation details that change frequently

### Documentation Lifecycle

**Persistent docs** (stay in project):
- Architecture decisions
- API documentation
- Workflow guides
- Design specifications

**Ephemeral content** (don't commit to docs/):
- Session summaries
- Progress reports
- Temporary working notes
- Personal learning logs

**Where to put ephemeral content:**
- Git commit messages for work history
- Pull request descriptions for change rationale
- Chat/conversation logs for discussions
- Personal notes outside the repository

---

**Remember**: This is a document-driven project. When in doubt, check the docs first, then ask questions, then propose solutions.

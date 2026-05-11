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

### Before Committing Checklist

- [ ] Code follows style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Commit message follows conventional format
- [ ] No debug code left in (console.log, etc.)
- [ ] Branch is up to date with main
- [ ] **Version bump ONLY if releasing new version** (check package.json)

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

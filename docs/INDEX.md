# Documentation Index

Complete documentation map for SC8P053VM project.

## Quick Navigation

### 🚀 Getting Started
- **[AGENTS.md](../AGENTS.md)** - Agent entry point and behavior guidelines (START HERE)
- **[docs/ONBOARDING.md](./ONBOARDING.md)** - New developer onboarding guide
- **[README.md](../README.md)** - Project overview and API reference

### 📋 Development Workflow
- **[docs/WORKFLOW.md](./WORKFLOW.md)** - Complete development workflow (TDD process)
- **[docs/COMPONENTS.md](./COMPONENTS.md)** - Reusable components and APIs directory
- **[docs/LINT_GUIDE.md](./LINT_GUIDE.md)** - Code quality tools (ESLint + Prettier)
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Contribution guidelines

### 🏗️ Code Structure
- **[docs/CODE_STRUCTURE.md](./CODE_STRUCTURE.md)** - Complete code module map and architecture

### 🧪 Testing
- **[docs/TESTING.md](./TESTING.md)** - Testing guide (Jest + custom test framework)
- **[src/cc-test.md](../src/cc-test.md)** - Compiler bug tracking and test documentation (105 bugs)

### 📐 Design & Planning
- **[docs/superpowers/specs/](./superpowers/specs/)** - Feature design documents
- **[docs/superpowers/plans/](./superpowers/plans/)** - Implementation plans
- **[docs/decisions/](./decisions/)** - Architecture decision records (ADRs)

### 🔧 Skills Reference
- Skills are installed in your agent's skill directory and available automatically

---

## Documentation by Purpose

### For New Developers/Agents
1. Read **[AGENTS.md](../AGENTS.md)** first
2. Follow **[ONBOARDING.md](./ONBOARDING.md)** for setup
3. Review **[CODE_STRUCTURE.md](./CODE_STRUCTURE.md)** to understand codebase
4. Study **[WORKFLOW.md](./WORKFLOW.md)** for development process

**Quick Build Reference:**
- `src/` changes → `npm run build`
- `example/` changes → `npm run dev`
- Use LSP for inline error checking (recommended)

### For Feature Development
1. Determine documentation level (see **[AGENTS.md](../AGENTS.md)** "Documentation Requirements by Task Type")
2. Use `brainstorming` skill to explore requirements
3. Write design spec in `docs/superpowers/specs/` (Level 1 & 2 only)
4. Create implementation plan in `docs/superpowers/plans/` (Level 1 & 2 only)
5. **⚠️ CRITICAL**: Verify both spec and plan exist before coding!
6. Follow **[WORKFLOW.md](./WORKFLOW.md)** TDD process
7. Check **[COMPONENTS.md](./COMPONENTS.md)** for existing utilities

### For Bug Fixes
1. Use `systematic-debugging` skill
2. Check existing specs and decisions for context
3. Follow TDD workflow from **[WORKFLOW.md](./WORKFLOW.md)**

### For Understanding Architecture
1. Read **[CODE_STRUCTURE.md](./CODE_STRUCTURE.md)**
2. Review **[decisions/](./decisions/)** for historical choices
3. Check relevant specs in `superpowers/specs/`

---

## Documentation Categories

### Entry Points
| Document | Purpose | Audience |
|----------|---------|----------|
| [AGENTS.md](../AGENTS.md) | Agent behavior guide | AI Agents |
| [ONBOARDING.md](./ONBOARDING.md) | Setup & getting started | New developers |
| [README.md](../README.md) | Project overview | Everyone |

### Process & Workflow
| Document | Purpose | When to Use |
|----------|---------|-------------|
| [WORKFLOW.md](./WORKFLOW.md) | TDD development process | Before coding |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute | Before PRs |

### Reference
| Document | Purpose | When to Use |
|----------|---------|-------------|
| [CODE_STRUCTURE.md](./CODE_STRUCTURE.md) | Code module map | Understanding codebase |
| [COMPONENTS.md](./COMPONENTS.md) | API directory | Avoiding reinvention |

### Design Records
| Directory | Purpose | Content |
|-----------|---------|---------|
| `superpowers/specs/` | Feature designs | What and why |
| `superpowers/plans/` | Implementation plans | How to build |
| `decisions/` | Architecture decisions | Historical choices |

---

## How Documentation Works

### What Belongs in docs/

**Persistent Knowledge (Include):**
- Architecture decisions and rationale
- API references and usage guides
- Development workflows
- Design specifications
- Onboarding materials

**Ephemeral Content (Exclude):**
- ❌ Work session summaries
- ❌ Progress reports
- ❌ Temporary notes
- ❌ Personal learning logs

**Why:** docs/ is for project knowledge that persists across time and helps future developers/agents. Session summaries belong in git commits, PR descriptions, or conversation logs.

### Document-Driven Development Flow

```
Idea → Brainstorming → Spec → Plan → Implementation → Verification
         (skill)      (doc)  (doc)    (code)        (tests)
```

1. **Brainstorming** - Explore requirements using `brainstorming` skill
2. **Spec** - Write design document in `docs/superpowers/specs/`
3. **Plan** - Create implementation plan in `docs/superpowers/plans/`
4. **Implementation** - Execute plan following TDD
5. **Verification** - Run tests and verify completion

### Updating Documentation

When making changes:
- ✅ Update affected specs if design changes
- ✅ Add new decisions to `decisions/` for major choices
- ✅ Update CODE_STRUCTURE.md if modules change
- ✅ Update COMPONENTS.md if adding reusable APIs
- ✅ Keep ONBOARDING.md current with setup steps

---

## Missing Something?

If you can't find what you need:
1. Search this index for keywords
2. Check related documents
3. Ask for clarification
4. Consider creating new documentation if gap is identified

---

**Last Updated**: 2026-05-21
**Maintained By**: Project team and AI agents

# Onboarding Guide

Complete guide for new developers and agents to get started with SC8P053VM.

## Prerequisites

### Required Software
- **Node.js** (v16 or higher) - Runtime environment
- **npm** - Package manager
- **Git** - Version control
- **TypeScript** - Language compiler (installed via npm)

### Recommended Tools
- **VS Code** - Code editor with TypeScript support
- **Chrome/Firefox** - For running the debugger UI

---

## Environment Setup

### Step 1: Clone Repository

```bash
git clone https://github.com/zycwind/sc8p053vm.git
cd sc8p053vm
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs:
- **Runtime dependencies**: highlight.js, react
- **Dev dependencies**: TypeScript, webpack, tree-sitter, etc.

### Step 3: Build Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Step 4: Verify Installation

Check that the build succeeded:
```bash
ls dist/
# Should contain: index.js, index.d.ts, vm.js, cc.js, asmc.js
```

---

## Development Workflow

### Understanding the Process

SC8P053VM follows **document-driven development** with **Test-Driven Development (TDD)**:

```
Idea → Brainstorming → Spec → Plan → Test → Code → Verify → Document
```

### Complete Workflow

#### 1. Understand the Task
- Read requirements carefully
- Check existing documentation (docs/INDEX.md)
- Search for similar implementations in codebase

#### 2. Design Phase (for non-trivial changes)
- Use `brainstorming` skill to explore approach
- Write design spec: `docs/superpowers/specs/YYYY-MM-DD-feature-design.md`
- Get design approval before proceeding

#### 3. Planning Phase
- Create implementation plan: `docs/superpowers/plans/YYYY-MM-DD-feature-plan.md`
- Break down into small, testable tasks
- Define success criteria

#### 4. Testing Phase (TDD)
- **Write failing test first** - This is MANDATORY
- Test should clearly define expected behavior
- Run test to confirm it fails

#### 5. Implementation Phase
- Write minimal code to pass test
- Keep changes focused and small
- Run tests frequently

#### 6. Refactoring Phase
- Improve code quality while keeping tests green
- Follow coding standards
- Update documentation if needed

#### 7. Verification Phase
- Run all tests: ensure nothing broke
- Use `verification-before-completion` skill
- Check edge cases and error handling

#### 8. Documentation Phase
- Update relevant docs if behavior changed
- Add examples if adding new APIs
- Commit documentation with code

---

## Common Tasks

### Building and Testing

**CRITICAL**: Different directories use different build systems!

#### For src/ directory (core library):
```bash
npm run build          # Compile TypeScript to dist/
```

This compiles:
- `src/vm.ts` → `dist/vm.js`
- `src/cc.ts` → `dist/cc.js`
- `src/asmc.ts` → `dist/asmc.js`
- `src/index.ts` → `dist/index.js`

Use this when:
- Modifying files in `src/`
- Preparing for npm publish
- Testing the library API

#### For example/ directory (frontend debugger):
```bash
npm run dev            # Start webpack dev server with hot reload
```

This:
- Compiles `example/src/index.tsx` using webpack
- Provides live reloading on changes
- Shows TypeScript errors in browser console and terminal
- Runs on http://localhost:8080 (or configured port)

**DO NOT use `npm run build` to check example/ files!**
- `npm run build` ONLY compiles src/ directory
- Use `npm run dev` for example/ development
- Webpack will show TypeScript errors in real-time
- The dev server has hot module replacement (HMR)

### Verification Workflow

**After making changes:**

1. **For src/ changes:**
   ```bash
   npm run build        # Check for TypeScript errors
   ```

2. **For example/ changes:**
   ```bash
   npm run dev          # Start dev server, watch for errors
   # OR if already running, just save the file - webpack will recompile
   ```

3. **Using LSP (Recommended):**
   - Most IDEs have TypeScript LSP built-in
   - Errors appear inline as you type
   - No need to run build commands for syntax checking
   - Use build commands only for final verification before commit

### Adding New Features

1. Check `docs/COMPONENTS.md` for existing utilities
2. Use `brainstorming` skill to design approach
3. Write spec in `docs/superpowers/specs/`
4. Create plan in `docs/superpowers/plans/`
5. Follow TDD workflow

### Fixing Bugs

1. Use `systematic-debugging` skill
2. Write test case that reproduces bug
3. Fix bug to make test pass
4. Add regression test

### Running Tests

Currently, the project doesn't have automated test suite. When implementing tests:
- Create test files alongside source files (*.test.ts)
- Or create separate test directory
- Follow TDD principles from `docs/WORKFLOW.md`

---

## Key Concepts

### SC8P053 Microcontroller
- 8-bit MCU with specific instruction set
- 256 bytes RAM, 8-level stack
- Peripherals: timers, PWM, comparators, I/O ports

### Virtual Machine (VM)
- Simulates SC8P053 hardware behavior
- Executes instructions cycle-by-cycle
- Provides I/O callbacks for peripheral interaction

### Compiler (cc.ts)
- Translates C code to SC8P053 machine code
- Uses tree-sitter for parsing
- Generates debug information for debugging

### Assembler (asmc.ts)
- Processes assembly code
- Converts to machine code for VM execution

### Frontend Debugger (example/src/index.tsx)
- React-based UI for visualizing VM state
- Real-time register/memory display
- Interactive debugging controls

---

## Coding Standards

### TypeScript Guidelines
- Use strict type checking
- Avoid `any` types unless absolutely necessary
- Prefer interfaces over type aliases for public APIs
- Use meaningful variable/function names

### File Organization
- One class per file (typically)
- Related utilities in same module
- Clear separation of concerns

### Documentation
- JSDoc comments for public APIs
- Inline comments for complex logic
- Update README when adding features

### Git Commits
- Clear, descriptive commit messages
- Reference issues/tickets if applicable
- Keep commits focused (one logical change per commit)

---

## Troubleshooting

### Build Fails

**Problem**: TypeScript compilation errors
```bash
npm run build
```
**Solution**: 
- Check error messages for type issues
- Ensure all dependencies installed: `npm install`
- Verify TypeScript version compatibility

### Module Resolution Errors

**Problem**: "Cannot find module" errors
**Solution**:
- Check `tsconfig.json` settings
- Ensure `moduleResolution` is set correctly
- Rebuild after config changes: `npm run build`

### Debugger UI Not Loading

**Problem**: Blank page or errors in browser console
**Solution**:
- Check webpack dev server is running: `npm run dev`
- Verify no port conflicts (default: 8080)
- Check browser console for errors

### Performance Issues

**Problem**: VM runs slowly
**Solution**:
- Check for infinite loops in code
- Reduce maxCycles parameter if too high
- Profile using browser DevTools

---

## Learning Resources

### Project Documentation
- **[AGENTS.md](../AGENTS.md)** - Agent behavior guide
- **[CODE_STRUCTURE.md](./CODE_STRUCTURE.md)** - Code architecture
- **[WORKFLOW.md](./WORKFLOW.md)** - Development process
- **[COMPONENTS.md](./COMPONENTS.md)** - API reference

### External Resources
- **SC8P053 Datasheet** - Hardware specifications (in example/doc/)
- **TypeScript Handbook** - Language reference
- **React Documentation** - Frontend framework guide
- **tree-sitter Docs** - Parser library

### Skills Reference
- Skills are installed in your agent's skill directory
- Use `brainstorming` for design exploration
- Use `test-driven-development` for TDD process
- Use `systematic-debugging` for debug methodology

---

## Getting Help

### When Stuck
1. **Check documentation** - Search docs/INDEX.md
2. **Use appropriate skill** - brainstorming, systematic-debugging, etc.
3. **Ask questions** - Clarify requirements if unclear
4. **Review similar code** - Learn from existing implementations

### Communication
- Be specific about the problem
- Include error messages and context
- Explain what you've tried already
- Propose potential solutions

---

## Next Steps

After completing onboarding:

1. ✅ Read **[CODE_STRUCTURE.md](./CODE_STRUCTURE.md)** to understand codebase
2. ✅ Study **[WORKFLOW.md](./WORKFLOW.md)** for detailed TDD process
3. ✅ Review **[COMPONENTS.md](./COMPONENTS.md)** for available APIs
4. ✅ Pick a small task to practice workflow
5. ✅ Start contributing!

---

**Remember**: This is a document-driven project. Always check docs first, follow established workflows, and contribute back to documentation when you learn something new.

**Last Updated**: 2026-05-11

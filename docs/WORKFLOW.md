# Development Workflow

Complete guide to the SC8P053VM development process, following Test-Driven Development (TDD) and document-driven principles.

## Core Principles

### 1. Document-Driven Development
**Documentation requirements vary by task type.**

Not all tasks need full spec + plan. Use the appropriate level:

#### Documentation Levels

**Level 1: Major Architecture Changes** (e.g., new subsystem, tech migration)
- Required: ADR + Spec + Plan
- Example: Adding document-driven development infrastructure

**Level 2: Feature Development** (e.g., new VM instruction, compiler feature)
- Required: Spec + Plan
- Example: Adding comprehensive error detection

**Level 3: Tool Configuration / Infrastructure** (e.g., add linting, update deps)
- Required: Update existing docs
- Optional: ADR (if significant decision)
- NOT Required: Spec, Plan
- Example: Adding ESLint + Prettier

**Level 4: Simple Bug Fixes / Small Changes** (e.g., fix typo, adjust styling)
- Required: No new docs needed
- Example: Fixing register display bug

**Decision Flowchart**:
```
Major architecture change?
├─ YES → Level 1 (ADR + Spec + Plan)
└─ NO
   ├─ New feature or significant functionality?
   │  ├─ YES → Level 2 (Spec + Plan)
   │  └─ NO
   │     ├─ Tool configuration or infrastructure?
   │     │  ├─ YES → Level 3 (Update docs, ADR optional)
   │     │  └─ NO → Level 4 (No new docs needed)
```

**Key Principle**: Documentation should add value, not create bureaucracy.

Workflow for Level 1 & 2:
```
Idea → Brainstorming → Spec → Plan → Implementation → Verification
```

### 2. Test-Driven Development (TDD)
**Write tests BEFORE writing implementation code.**

RED-GREEN-REFACTOR cycle:
1. **RED**: Write failing test
2. **GREEN**: Write minimal code to pass test
3. **REFACTOR**: Improve code while keeping tests green

### 3. Incremental Development
**Small, focused changes are better than large refactors.**

- One feature per branch
- One logical change per commit
- Frequent testing and verification

---

## Complete Development Process

### Phase 1: Understanding & Design

#### Step 1: Clarify Requirements
- Read the task/request carefully
- Ask questions if anything is unclear
- Identify success criteria
- Check for similar existing implementations

**Use skill**: `brainstorming` (for complex features)

#### Step 2: Research Context
- Search `docs/INDEX.md` for relevant documentation
- Review `docs/CODE_STRUCTURE.md` for module responsibilities
- Check `docs/COMPONENTS.md` for existing utilities
- Look at git history for related changes

#### Step 3: Design Solution (Non-Trivial Changes)
For features, architectural changes, or complex bug fixes:

1. **Brainstorm approaches** - Use `brainstorming` skill
   - Explore 2-3 different solutions
   - Consider trade-offs
   - Get user feedback

2. **Write design spec** - Create file in `docs/superpowers/specs/`
   ```
   docs/superpowers/specs/YYYY-MM-DD-feature-name-design.md
   ```
   
   Spec should include:
   - Problem statement
   - Proposed solution
   - Architecture/components
   - API design
   - Data flow
   - Error handling
   - Testing strategy

3. **Get approval** - Share spec with team/user
   - Revise based on feedback
   - Ensure everyone agrees on approach

---

### Phase 2: Planning

#### Step 4: Create Implementation Plan
After spec approval, create detailed plan in `docs/superpowers/plans/`:

```
docs/superpowers/plans/YYYY-MM-DD-feature-name-plan.md
```

Plan should include:
- Task breakdown (small, testable units)
- Order of implementation
- Dependencies between tasks
- Success criteria for each task
- Estimated effort

**Use skill**: `writing-plans` to create the implementation plan

---

#### ⚠️ CRITICAL CHECKPOINT: Before Starting Implementation

**STOP! Verify documentation is complete before writing ANY code:**

For **Level 1** (Major Architecture) and **Level 2** (Feature Development):
- [ ] Design spec exists in `docs/superpowers/specs/`
- [ ] Implementation plan exists in `docs/superpowers/plans/`
- [ ] Both documents have been reviewed/approved

**DO NOT proceed to Phase 3 until these are complete!**

If you're working on Level 3 or 4 tasks, you can skip this check.

---

### Phase 3: Test-Driven Implementation

#### Step 5: Write Failing Test (RED)

**MANDATORY**: Always start with a failing test.

```typescript
// example.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from './myModule';

describe('myFunction', () => {
  it('should handle basic case', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = myFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
  
  it('should handle edge case', () => {
    // This test should FAIL initially
    expect(() => myFunction('')).toThrow();
  });
});
```

**Test Quality Checklist**:
- ✅ Clear test name describing behavior
- ✅ Single assertion per test (mostly)
- ✅ Covers happy path AND edge cases
- ✅ Tests error conditions
- ✅ Independent (no test order dependency)
- ✅ Fast execution (< 1 second)

#### Step 6: Run Test to Confirm Failure

```bash
# Run specific test
npm test -- myFunction.test.ts

# Or run all tests
npm test
```

**Verify**: Test fails with expected error message. If it passes, you've made a mistake.

---

### Phase 4: Implementation (GREEN)

#### Step 7: Write Minimal Code to Pass Test

Write the SIMPLEST code that makes the test pass.

```typescript
// myModule.ts
export function myFunction(input: string): string {
  if (input === '') {
    throw new Error('Input cannot be empty');
  }
  return 'expected'; // Simplest implementation
}
```

**Principles**:
- Don't over-engineer
- Don't add features not tested
- Keep it simple and focused
- Make the test pass, nothing more

#### Step 8: Run Test to Confirm Success

```bash
npm test -- myFunction.test.ts
```

**Verify**: Test passes. If not, debug and fix.

---

### Phase 5: Refactoring

#### Step 9: Improve Code Quality

Now that tests pass, improve the code:

- Better variable names
- Extract helper functions
- Reduce duplication
- Improve performance
- Add comments for complex logic

**CRITICAL**: Run tests after EVERY refactoring step.

```bash
npm test
```

Tests MUST stay green. If they fail, revert and refactor more carefully.

#### Step 10: Add More Tests (Optional)

If you discover edge cases during refactoring:

1. Write new failing test
2. Update code to pass
3. Refactor again
4. Repeat until satisfied

---

### Phase 6: Integration

#### Step 11: Connect to Existing Code

Integrate your new feature with the rest of the system:

- Import/export modules correctly
- Update public APIs if needed
- Handle integration edge cases
- Update type definitions

#### Step 12: Write Integration Tests

Test how your feature works with other modules:

```typescript
describe('Integration: VM + Compiler', () => {
  it('should compile and execute C code', async () => {
    const cCode = 'void main() { char x = 10; }';
    const { rom } = await compile(cCode);
    const vm = new VM(rom);
    vm.run(100);
    
    expect(vm.getState().pc).toBeGreaterThan(0);
  });
});
```

---

### Phase 7: Verification

#### Step 13: Run All Tests

```bash
npm test
```

**Verify**: ALL tests pass, not just your new ones.

#### Step 14: Build Verification

**For src/ changes:**
```bash
npm run build
```
- Check for TypeScript compilation errors
- Ensure dist/ output is correct

**For example/ changes:**
```bash
npm run dev
```
- Start dev server and check browser console
- OR if already running, webpack will show errors automatically
- Verify UI works as expected

**Using LSP (Recommended):**
- Most IDEs show TypeScript errors inline
- Check Problems panel before building
- Fix LSP errors first, then build for final verification

**DO NOT:**
- Use `npm run build` to check example/ files
- Ignore LSP errors and try to build anyway
- Run build after every small change (use LSP instead)

#### Step 15: Manual Testing

For UI changes or complex features:

1. Build project: `npm run build`
2. Run debugger: `npm run dev`
3. Test in browser
4. Verify expected behavior
5. Check for regressions

#### Step 16: Edge Case Testing

Test boundary conditions:
- Empty inputs
- Maximum values
- Invalid data
- Concurrent operations
- Error recovery

**Use skill**: `verification-before-completion`

---

### Phase 8: Documentation

#### Step 17: Update Documentation

Update relevant docs based on changes:

- **API changes**: Update `docs/COMPONENTS.md`
- **Architecture changes**: Update `docs/CODE_STRUCTURE.md`
- **New setup steps**: Update `docs/ONBOARDING.md`
- **Design decisions**: Add to `docs/decisions/`
- **README**: Update if public API changed

#### Step 18: Add Code Comments

Add JSDoc comments for public APIs:

```typescript
/**
 * Executes VM for specified number of cycles.
 * @param maxCycles - Maximum cycles to execute (default: unlimited)
 * @param stepCallback - Called after each instruction
 * @throws {Error} If invalid state detected
 */
run(maxCycles?: number, stepCallback?: () => void): void
```

---

### Phase 9: Commit & Review

#### Step 19: Prepare Commit

Review your changes:

```bash
git status
git diff
```

**Checklist**:
- ✅ Only intended files modified
- ✅ No debug code left in
- ✅ No console.log statements
- ✅ Tests included
- ✅ Documentation updated

#### Step 20: Write Commit Message

Follow conventional commits format:

```
feat(vm): add PWM dead-time support

- Implement dead-time control for PWM0/PWM1
- Add PWMCON1 register bit definitions
- Update PWM timing calculations
- Add unit tests for dead-time scenarios

Refs: #123
```

Format: `<type>(<scope>): <subject>`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting (no logic change)
- `refactor`: Code restructuring
- `test`: Adding/updating tests
- `chore`: Maintenance tasks

**Commit Granularity**: Group related changes into logical commits.
- ✅ **Good**: All config files together, all tests for one feature together
- ❌ **Bad**: One commit per file or per task step
- **Rule**: If two changes are needed together, they should be in the same commit

See **[AGENTS.md](../AGENTS.md)** "Commit Granularity" section for detailed guidelines.

#### Step 21: Commit and Push

```bash
git add .
git commit -m "your commit message"
git push
```

#### Step 22: Code Review (if applicable)

**Use skill**: `requesting-code-review`

Create pull request and request review from team members.

Address feedback:
- Make requested changes
- Re-run tests
- Update PR
- Get approval

---

## Special Workflows

### Bug Fix Workflow

1. **Reproduce the bug**
   - Write test case that fails
   - Document steps to reproduce

2. **Debug systematically**
   - **Use skill**: `systematic-debugging`
   - Find root cause
   - Don't just fix symptoms

3. **Fix the bug**
   - Write minimal fix
   - Ensure test now passes
   - Add regression test

4. **Verify no regressions**
   - Run all tests
   - Manual testing if needed

### Refactoring Workflow

1. **Ensure comprehensive tests exist**
   - If not, write tests first
   - Tests must cover current behavior

2. **Make small changes**
   - One refactoring at a time
   - Run tests after each change

3. **Verify behavior unchanged**
   - All tests still pass
   - Manual testing if needed

4. **Commit incrementally**
   - Separate commits for each refactoring
   - Clear commit messages

### Feature Addition Workflow

Follow the complete process above, emphasizing:
- Design spec first
- TDD throughout
- Integration testing
- Documentation updates

---

## Common Pitfalls to Avoid

### ❌ Skipping Tests
**Wrong**: Write code first, add tests later
**Right**: Write test first, then code

### ❌ Large Commits
**Wrong**: 50 files changed, 1000 lines
**Right**: Small, focused commits

### ❌ No Documentation
**Wrong**: Code only, no docs
**Right**: Update docs with code changes

### ❌ Ignoring Edge Cases
**Wrong**: Only test happy path
**Right**: Test edge cases and errors

### ❌ Copy-Paste Code
**Wrong**: Duplicate logic
**Right**: Extract reusable functions

### ❌ Breaking Public API
**Wrong**: Change API without warning
**Right**: Deprecate first, then remove

---

## Tools & Commands

### Build
```bash
npm run build          # Compile TypeScript
```

### Development
```bash
npm run dev            # Start dev server
```

### Testing
```bash
npm test               # Run backend tests (src/__tests__)
npm run test:example   # Run frontend tests (example/src/__tests__)
```

### Linting (if configured)
```bash
npm run lint           # Check code style
npm run lint:fix       # Auto-fix issues
```

---

## Skills Reference

When to use which skill:

| Skill | When to Use |
|-------|-------------|
| `brainstorming` | Before any creative work (features, designs) |
| `writing-plans` | After spec approval, before coding |
| `test-driven-development` | When implementing features/bugfixes |
| `systematic-debugging` | When encountering bugs |
| `verification-before-completion` | Before claiming work done |
| `requesting-code-review` | Before merging major changes |
| `receiving-code-review` | When getting feedback |

---

## Quick Reference Checklist

### Before Starting
- [ ] Understand requirements
- [ ] Check existing docs/code
- [ ] Use brainstorming skill if needed

### During Development
- [ ] Write spec (non-trivial changes)
- [ ] Create plan
- [ ] Write failing test first
- [ ] Write minimal code
- [ ] Refactor with tests green
- [ ] Add integration tests

### Before Finishing
- [ ] All tests pass
- [ ] Manual testing done
- [ ] Documentation updated
- [ ] Code reviewed
- [ ] Commit message clear

---

**Remember**: This workflow exists to ensure quality and maintainability. Following it consistently leads to better code, fewer bugs, and easier maintenance.

**Last Updated**: 2026-05-11

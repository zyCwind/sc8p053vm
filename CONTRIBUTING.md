# Contributing to SC8P053VM

Thank you for your interest in contributing! This guide explains how to contribute effectively.

---

## Code of Conduct

Please be respectful and constructive in all interactions. We're building something great together.

---

## How to Contribute

### Reporting Bugs

1. **Search existing issues** first (might already be reported)
2. **Create new issue** with:
   - Clear title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node version, OS)
   - Code sample if applicable

### Suggesting Features

1. **Open an issue** describing the feature
2. **Explain the use case** - why is this needed?
3. **Propose implementation approach** (optional)
4. **Discuss with maintainers** before implementing

### Submitting Code

Follow this process:

1. **Fork the repository**
2. **Create feature branch** from `main`
3. **Make your changes** following our workflow
4. **Write/update tests**
5. **Update documentation**
6. **Submit pull request**

---

## Development Standards

### Code Style

- **TypeScript**: Use strict typing, avoid `any`
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Formatting**: Consistent indentation (2 spaces)
- **Comments**: JSDoc for public APIs, inline for complex logic

### Commit Messages

Follow conventional commits format:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting (no code change)
- `refactor`: Code restructuring
- `test`: Adding/updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(vm): add PWM dead-time support

Implement dead-time control for PWM0/PWM1 pairs.
Add PWMCON1 register bit definitions.

Refs: #123
```

```
fix(compiler): handle array initialization correctly

Fix bug where array initializers were not properly
converted to RAM initialization code.
```

### Branch Naming

Use descriptive branch names:
- `feat/add-pwm-deadtime`
- `fix/compiler-array-bug`
- `docs/update-api-reference`

---

## Workflow Requirements

### Document-Driven Development

For non-trivial changes:

1. **Write design spec** in `docs/superpowers/specs/`
2. **Create implementation plan** in `docs/superpowers/plans/`
3. **Get approval** before coding
4. **Follow TDD** throughout implementation

See **[docs/WORKFLOW.md](./docs/WORKFLOW.md)** for complete process.

### Test-Driven Development

**MANDATORY**: Write tests BEFORE implementation code.

1. Write failing test
2. Write minimal code to pass
3. Refactor while keeping tests green
4. Never skip testing

### Documentation Updates

When making changes:

- ✅ Update affected API docs
- ✅ Add examples for new features
- ✅ Update ONBOARDING.md if setup changes
- ✅ Add decision record for major choices

---

## Pull Request Process

### Before Submitting

**Checklist**:
- [ ] Code follows style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Commit messages clear
- [ ] No debug code left in
- [ ] No console.log statements
- [ ] Branch is up to date with main

### PR Description

Include:
- **What** changed
- **Why** it changed
- **How** to test it
- **Related issues** (link with #issue-number)

### Code Review

1. Maintainers will review your PR
2. Address feedback constructively
3. Make requested changes
4. Re-run tests after changes
5. Get approval before merging

### Merging

- Squash commits if multiple small commits
- Use merge commit or rebase (maintainer's choice)
- Delete feature branch after merge

---

## Testing Guidelines

### Writing Tests

**Test Structure**:
```typescript
describe('FeatureName', () => {
  it('should handle basic case', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = myFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
  
  it('should handle edge case', () => {
    // Test edge cases too
  });
});
```

**Test Quality**:
- ✅ Clear, descriptive names
- ✅ Single assertion per test (mostly)
- ✅ Cover happy path AND edge cases
- ✅ Test error conditions
- ✅ Independent (no order dependency)
- ✅ Fast execution

### Running Tests

```bash
npm test              # Run all tests
npm test -- file      # Run specific test
npm test -- --watch   # Watch mode
```

---

## Documentation Guidelines

### Writing Good Docs

**Principles**:
- Clear and concise
- Include examples
- Explain WHY, not just WHAT
- Keep up to date
- Link to related docs

**Structure**:
- Overview/purpose
- Usage examples
- API reference
- Common patterns
- Troubleshooting

### Doc Locations

- **API docs**: `docs/COMPONENTS.md`
- **Architecture**: `docs/CODE_STRUCTURE.md`
- **Workflow**: `docs/WORKFLOW.md`
- **Design specs**: `docs/superpowers/specs/`
- **Decisions**: `docs/decisions/`

---

## Common Contribution Types

### Bug Fixes

1. Reproduce the bug
2. Write test case that fails
3. Fix the bug
4. Verify test passes
5. Add regression test
6. Submit PR

### New Features

1. Discuss in issue first
2. Write design spec
3. Create implementation plan
4. Follow TDD workflow
5. Add comprehensive tests
6. Update documentation
7. Submit PR

### Documentation Improvements

1. Identify gap or error
2. Make improvement
3. Verify accuracy
4. Submit PR with clear description

### Performance Optimizations

1. Profile to identify bottleneck
2. Propose optimization approach
3. Benchmark before/after
4. Ensure tests still pass
5. Document performance impact
6. Submit PR with benchmarks

---

## Getting Help

### Questions?

- **Check documentation** first: `docs/INDEX.md`
- **Search existing issues** on GitHub
- **Ask in discussion** forum (if available)
- **Contact maintainers** via issue

### Stuck?

Don't hesitate to ask for help! Better to ask than to waste time.

---

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

Thank you for contributing! 🎉

---

## License

By contributing, you agree that your contributions will be licensed under the project's BSL-1.1 license (changing to MIT after 2099-12-31).

---

**Last Updated**: 2026-05-11

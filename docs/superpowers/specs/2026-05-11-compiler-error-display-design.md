# Design Spec: Compiler Error Display in Example Debugger

**Date**: 2026-05-11  
**Status**: Proposed  
**Author**: AI Agent  
**Reviewers**: Project team

---

## Overview

This spec documents the design for displaying compiler error messages in the example debugger's bottom status bar when C code compilation fails. The goal is to provide immediate, visible feedback to users about compilation errors without disrupting the debugging workflow.

**Core principle**: Errors should be visible but non-intrusive, following IDE conventions.

---

## Problem Statement

Currently, when the C compiler (`cc.ts`) throws an error during compilation in the example frontend:

1. **Silent failures** - The `try-catch` blocks in `run()`, `step()`, and `reset()` methods catch errors but do nothing (empty catch blocks)
2. **No user feedback** - Users have no indication why compilation failed
3. **Debugging difficulty** - Users must check browser console to see error messages
4. **Poor UX** - Violates basic usability principles for development tools

Example of current problematic code:
```typescript
private async run() {
    try {
        if (!this.state.vm) {
            await this.compileCode();
        }
        // ...
    } catch (e) {
        // Empty - error is silently swallowed
    }
}
```

---

## Requirements

### Functional Requirements

1. **Error Capture**: Capture all compilation errors from the `compile()` function
2. **Error Display**: Show error messages in the bottom status bar (footer)
3. **Error Clearing**: Automatically clear errors when compilation succeeds
4. **Error Persistence**: Keep error visible until next compilation attempt
5. **Non-blocking**: Error display should not prevent other UI interactions

### Non-Functional Requirements

1. **Minimal changes**: Follow "最小化代码变更原则"
2. **Consistent styling**: Match existing UI design patterns
3. **Performance**: No impact on compilation or execution speed
4. **Accessibility**: Error text should be readable and distinguishable

---

## Architecture

### Component Structure

The implementation affects three layers:

```
┌─────────────────────────────────────┐
│   React State Layer                 │
│   - Add 'error' field to state      │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Business Logic Layer              │
│   - Modify compileCode() method     │
│   - Capture and store errors        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Presentation Layer                │
│   - Render error in footer          │
│   - Conditional styling             │
└─────────────────────────────────────┘
```

### Data Flow

1. User triggers compilation (via run/step/reset)
2. `compileCode()` calls `compile(source)` from `sc8p053vm`
3. If compilation fails → catch error → update state with error message
4. If compilation succeeds → update state with debug info and clear error
5. Footer renders error conditionally based on state

---

## Design Decisions

### Decision 1: Error Storage Location

**Option A**: Store error in component state (chosen)
- Pros: Simple, reactive, follows React patterns
- Cons: None significant for this use case

**Option B**: Use a separate error management system
- Pros: More scalable for complex error handling
- Cons: Overkill for single error display

**Rationale**: This is a simple feature. Component state is sufficient and follows existing patterns.

### Decision 2: Error Display Position

**Option A**: Bottom status bar / footer (chosen)
- Pros: 
  - Matches existing "编译错误显示决策-底部状态栏方案" memory
  - Non-intrusive, always visible
  - Consistent with IDE conventions (VS Code, etc.)
- Cons: Limited horizontal space for long messages

**Option B**: Modal dialog
- Pros: Forces user attention
- Cons: Disruptive, requires dismissal

**Option C**: Inline in code editor
- Pros: Context-aware
- Cons: Complex implementation, may obscure code

**Rationale**: Footer provides best balance of visibility and non-intrusiveness.

### Decision 3: Error Message Format

**Format**: Plain text error message from `Error.message`
- Extract full message: `e instanceof Error ? e.message : 'Unknown error'`
- No additional formatting or parsing
- Display as-is in footer

**Rationale**: Compiler already provides meaningful error messages. No need for additional processing.

### Decision 4: Error Clearing Strategy

**Strategy**: Auto-clear on successful compilation
- When `compileCode()` succeeds → set `error: null`
- User doesn't need manual dismissal
- Clean state after fix

**Rationale**: Automatic clearing reduces friction. User sees error disappears when they fix the code.

---

## Interface Changes

### State Interface Extension

Current state interface in `App` component:
```typescript
{
    breakpoints: Set<number>;
    code: string;
    currentLine?: number;
    debugInfo: DebugInfo | null;
    isBreakpointsEnabled: boolean;
    isRunning: boolean;
    ports: { A: number; B: number };
    vm: VM | null;
}
```

Extended state interface:
```typescript
{
    breakpoints: Set<number>;
    code: string;
    currentLine?: number;
    debugInfo: DebugInfo | null;
    error: string | null;  // NEW FIELD
    isBreakpointsEnabled: boolean;
    isRunning: boolean;
    ports: { A: number; B: number };
    vm: VM | null;
}
```

### Method Signature Changes

No changes to public method signatures. Only internal implementation changes to `compileCode()`.

---

## Error Handling Strategy

### Compilation Errors

All errors thrown by `compile()` function will be caught:
- Syntax errors (from tree-sitter parser)
- Semantic errors (type checking, recursion detection)
- Preprocessor errors (#if/#endif mismatches)
- Assembly errors (from `assemble()` call)

### Error Message Extraction

```typescript
try {
    const { debugInfo, rom } = await compile(this.state.code);
    // Success path - clear error and update state
    this.setState({
        currentLine: start !== undefined ? debugInfo.lineNoMap.get(start) : undefined,
        debugInfo,
        error: null,  // Clear previous errors on success
        vm,
    });
} catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown compilation error';
    // Display error in UI
    this.setState({ 
        debugInfo: null, 
        error: errorMessage, 
        vm: null 
    });
    // Rethrow to inform caller (run/step/reset) that compilation failed
    throw e;
}
```

**Key design decision**: After capturing and displaying the error, we **rethrow** it.

This follows the project's error handling pattern:
- **Bottom layer** (`compileCode`): Capture, record/display, then rethrow
- **Top layer** (`run`, `step`, `reset`): Empty catch blocks to prevent crash

The empty catch blocks in upper methods are intentional - they prevent unhandled promise rejections from crashing the app, while the error has already been shown to the user.

### Edge Cases

1. **Non-Error exceptions**: Handle with fallback message
2. **Empty error messages**: Display as-is (compiler should always provide message)
3. **Very long messages**: CSS will handle overflow (ellipsis or wrapping)
4. **Multiple errors**: Compiler throws on first error, so only one displayed

---

## UI/UX Considerations

### Visual Design

**Footer layout** (current):
```
[                                    CPU: 1234 ]
```

**Footer layout** (with error):
```
[ Error: Syntax error at line 5, column 10    CPU: 1234 ]
```

**Styling**:
- Error text color: `#e74c3c` (red, matches existing error/breakpoint colors)
- Label "Error:" prefix for clarity
- Flexbox layout: error takes available space, CPU cycles right-aligned
- Font size: 13px (consistent with footer)

### User Experience

1. **Immediate feedback**: Error appears instantly after failed compilation
2. **Clear indication**: Red color signals problem
3. **Actionable**: Message tells user what's wrong and where
4. **Auto-recovery**: Error clears when code is fixed and recompiled

---

## Testing Strategy

### Manual Testing Scenarios

1. **Syntax error**: Write invalid C syntax → verify error displays
2. **Semantic error**: Use undefined variable → verify error displays
3. **Successful compilation**: Fix error → verify error clears
4. **Long error message**: Trigger verbose error → verify display handles it
5. **Keyboard shortcuts**: Trigger compilation via F5/F10 → verify error works

### Automated Testing (Future)

Could add React component tests:
- Test error state rendering
- Test error clearing on success
- Test error message extraction

---

## Files to Modify

1. **example/src/index.tsx**
   - Add `error` field to state interface
   - Initialize `error: null` in constructor
   - Modify `compileCode()` to catch and store errors
   - Modify `render()` to display error in footer

2. **example/src/styles.css** (optional)
   - May add animation or special styling for error state
   - Current inline styles may be sufficient

---

## Migration Path

### Backward Compatibility

- No breaking changes
- Existing functionality unchanged
- Only adds new visual feedback

### Rollback Plan

If issues arise:
1. Revert changes to `index.tsx`
2. Remove error field from state
3. Restore original `compileCode()` implementation

Simple revert, no data migration needed.

---

## Success Criteria

1. ✅ Compilation errors are visible in UI
2. ✅ Error messages are accurate and helpful
3. ✅ Errors clear automatically on successful compilation
4. ✅ No performance degradation
5. ✅ UI remains responsive during error display
6. ✅ Styling matches existing design system

---

## Open Questions

None identified. Design is straightforward implementation of established pattern.

---

## References

- Memory: "编译错误显示决策-底部状态栏方案"
- AGENTS.md: Level 2 Feature Development requirements
- Existing footer implementation in `index.tsx` lines 684-689
- Compiler error throwing in `src/cc.ts`

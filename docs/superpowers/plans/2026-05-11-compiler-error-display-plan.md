# Compiler Error Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compiler error display in the example debugger's bottom status bar when C code compilation fails, following the project's error handling pattern (capture-display-rethrow).

**Architecture:** Extend React component state with error field, modify compileCode() to capture errors and rethrow, render error message in footer with conditional styling. Upper methods (run/step/reset) retain empty catch blocks per project convention.

**Tech Stack:** React 18, TypeScript, sc8p053vm compiler

---

## File Structure

### Files to Modify

1. **example/src/index.tsx**
   - Lines 18-32: State interface definition (add error field)
   - Lines 65-77: Constructor initialization (initialize error to null)
   - Lines 79-91: compileCode() method (add try-catch with error handling and rethrow)
   - Lines 684-689: Footer render section (add error display)

### No New Files

This feature only modifies existing files. No new components or utilities needed.

---

## Task 1: Extend State Interface

**Files:**
- Modify: `example/src/index.tsx:18-32`

- [ ] **Step 1: Add error field to state interface**

Locate the state interface definition (around line 18-32):

```typescript
class App extends React.Component<
    {},
    {
        breakpoints: Set<number>;
        code: string;
        currentLine?: number;
        debugInfo: DebugInfo | null;
        isBreakpointsEnabled: boolean;
        isRunning: boolean;
        ports: {
            A: number;
            B: number;
        };
        vm: VM | null;
    }
> {
```

Add `error: string | null;` field after `debugInfo`:

```typescript
class App extends React.Component<
    {},
    {
        breakpoints: Set<number>;
        code: string;
        currentLine?: number;
        debugInfo: DebugInfo | null;
        error: string | null;
        isBreakpointsEnabled: boolean;
        isRunning: boolean;
        ports: {
            A: number;
            B: number;
        };
        vm: VM | null;
    }
> {
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: No errors (error field properly typed)

---

## Task 2: Initialize Error State

**Files:**
- Modify: `example/src/index.tsx:65-77`

- [ ] **Step 1: Locate constructor**

Find the constructor method (around line 65-77):

```typescript
constructor(props: {}) {
    super(props);
    this.state = {
        breakpoints: new Set<number>(),
        code: '',
        currentLine: undefined,
        debugInfo: null,
        isBreakpointsEnabled: true,
        isRunning: false,
        ports: { A: 0, B: 0 },
        vm: null,
    };
}
```

- [ ] **Step 2: Add error initialization**

Add `error: null,` after `debugInfo: null,`:

```typescript
constructor(props: {}) {
    super(props);
    this.state = {
        breakpoints: new Set<number>(),
        code: '',
        currentLine: undefined,
        debugInfo: null,
        error: null,
        isBreakpointsEnabled: true,
        isRunning: false,
        ports: { A: 0, B: 0 },
        vm: null,
    };
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: No errors

---

## Task 3: Implement Error Capture with Rethrow in compileCode

**Files:**
- Modify: `example/src/index.tsx:79-91`

- [ ] **Step 1: Locate compileCode method**

Current implementation (around line 79-91):

```typescript
private async compileCode() {
    const { debugInfo, rom } = await compile(this.state.code);
    const vm = new VM(rom);
    vm.ioCallback = (ports) => {
        this.setState({ ports });
    };
    const { start } = debugInfo.fnRanges.get('main')?.[0] || {};
    this.setState({
        currentLine: start !== undefined ? debugInfo.lineNoMap.get(start) : undefined,
        debugInfo,
        vm,
    });
}
```

- [ ] **Step 2: Wrap in try-catch with error handling and rethrow**

Replace entire method with:

```typescript
private async compileCode() {
    try {
        const { debugInfo, rom } = await compile(this.state.code);
        const vm = new VM(rom);
        vm.ioCallback = (ports) => {
            this.setState({ ports });
        };
        const { start } = debugInfo.fnRanges.get('main')?.[0] || {};
        this.setState({
            currentLine: start !== undefined ? debugInfo.lineNoMap.get(start) : undefined,
            debugInfo,
            error: null,
            vm,
        });
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown compilation error';
        this.setState({
            debugInfo: null,
            error: errorMessage,
            vm: null,
        });
        throw e;
    }
}
```

Key changes:
- Wrapped entire method body in try-catch
- On success: set `error: null` to clear any previous errors
- On failure: 
  1. Extract error message
  2. Update state to display error and clear debugInfo/vm
  3. **Rethrow the error** to inform caller (per project error handling pattern)

The rethrow ensures that upper methods (run/step/reset) know compilation failed, even though their catch blocks are empty.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: No errors

---

## Task 4: Render Error in Footer

**Files:**
- Modify: `example/src/index.tsx:684-689`

- [ ] **Step 1: Locate footer section**

Current footer implementation (around line 684-689):

```tsx
<div className="debug-bar footer" id="status-bar">
    <div style={{ marginLeft: 'auto', color: '#ecf0f1', fontSize: '13px' }}>
        <span style={{ marginRight: '8px' }}>CPU:</span>
        <span id="cpu-cycles" style={{ color: '#ecf0f1' }}>{`${cycles}`}</span>
    </div>
</div>
```

- [ ] **Step 2: Add conditional error display**

Replace footer with:

```tsx
<div className="debug-bar footer" id="status-bar">
    {this.state.error && (
        <div style={{ flex: 1, color: '#ecf0f1', fontSize: '13px' }}>
            <span style={{ color: '#e74c3c', marginRight: '8px' }}>Error:</span>
            <span>{this.state.error}</span>
        </div>
    )}
    <div style={{ marginLeft: 'auto', color: '#ecf0f1', fontSize: '13px' }}>
        <span style={{ marginRight: '8px' }}>CPU:</span>
        <span id="cpu-cycles" style={{ color: '#ecf0f1' }}>{`${cycles}`}</span>
    </div>
</div>
```

Key changes:
- Added conditional rendering: `{this.state.error && (...)}`
- Error section uses `flex: 1` to take available space
- "Error:" label styled in red (`#e74c3c`) matching existing error/breakpoint colors
- CPU cycles remain right-aligned with `marginLeft: 'auto'`
- When no error, footer shows only CPU cycles (original behavior)

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: No errors

---

## Task 5: Test Error Display

**Files:**
- Test: Manual testing via browser

- [ ] **Step 1: Start development server**

Run: `npm run dev`
Expected: Webpack dev server starts on http://localhost:8080 (or similar port)

Open browser and navigate to the dev server URL.

- [ ] **Step 2: Trigger syntax error**

In the code editor, introduce a syntax error:
```c
void main() {
    int x = ;  // Missing value - syntax error
}
```

Click Run button (F5)
Expected: 
- Footer shows red "Error:" label followed by error message
- Error message displays (e.g., "Syntax error at line X, column Y")
- CPU cycles still visible on right side
- Debugger does not start (VM is null)

- [ ] **Step 3: Test semantic error**

Fix syntax error, introduce semantic error:
```c
void main() {
    undefinedVariable = 5;  // Undefined variable
}
```

Click Run button (F5)
Expected:
- Footer shows appropriate error message about undefined variable
- Error message is different from syntax error

- [ ] **Step 4: Test successful compilation clears error**

Fix all errors:
```c
void main() {
    int x = 5;
}
```

Click Run button (F5)
Expected:
- Error message disappears from footer
- Only CPU cycles visible in footer
- Debugger starts normally
- Current line highlighting works
- Registers and memory panels update

- [ ] **Step 5: Test error persists until fixed**

1. Introduce error in code
2. Click Run → error displays
3. Don't fix error, click Run again
Expected: Error still displays (not cleared)

4. Fix error, click Run
Expected: Error clears

- [ ] **Step 6: Test keyboard shortcuts**

With error in code:
- Press F5 (run) → verify error displays
- Press F10 (step) → verify error displays  
- Press Ctrl+Shift+F5 (reset) → verify error displays

All should show error in footer and not crash the application.

- [ ] **Step 7: Test long error messages**

Create code that generates a long error message (e.g., complex type error)
Expected:
- Error text displays in footer
- Text may wrap or truncate based on CSS
- UI remains functional
- CPU cycles still visible

---

## Task 6: Code Quality Check

**Files:**
- All modified files

- [ ] **Step 1: Run ESLint**

Run: `npm run lint`
Expected: No linting errors

If errors found:
Run: `npm run lint:fix`
Then re-run: `npm run lint`

- [ ] **Step 2: Run Prettier**

Run: `npm run format`
Expected: Files formatted correctly

- [ ] **Step 3: Final build verification**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 4: Verify no console errors**

In browser DevTools Console tab:
- No unhandled promise rejections
- No TypeScript runtime errors
- Only expected compiler error messages (when intentionally testing errors)

---

## Success Criteria Checklist

After completing all tasks, verify:

- [ ] Error field added to state interface with correct type
- [ ] Error initialized to null in constructor
- [ ] compileCode() wraps compilation in try-catch
- [ ] compileCode() displays error in state on failure
- [ ] compileCode() clears error on success
- [ ] compileCode() rethrows error after displaying (critical!)
- [ ] Footer conditionally renders error message
- [ ] Error styling matches design (red label, proper spacing)
- [ ] Syntax errors display correctly
- [ ] Semantic errors display correctly
- [ ] Successful compilation clears error
- [ ] Empty catch blocks in run/step/reset remain unchanged
- [ ] No TypeScript compilation errors
- [ ] No ESLint errors
- [ ] Application doesn't crash on compilation errors

---

## Notes

### Why Rethrow?

The rethrow in `compileCode()` is critical to the project's error handling architecture:

1. **Bottom layer responsibility**: `compileCode()` captures the error, extracts the message, updates UI state to show it to the user
2. **Signal to caller**: Rethrowing tells `run()`/`step()`/`reset()` that compilation failed
3. **Top layer safety**: Empty catch blocks prevent unhandled promise rejections from crashing the app
4. **User already informed**: Since error is displayed in UI before rethrow, user knows what went wrong

Without rethrow, the upper methods would continue execution as if compilation succeeded, potentially causing confusing behavior.

### Alternative Approaches Considered

**Option A**: Remove empty catch blocks from run/step/reset
- Rejected: Would cause unhandled promise rejections and app crashes

**Option B**: Return error instead of throwing
- Rejected: Would require changing method signatures and all call sites

**Option C**: Use event emitter or callback for error notification
- Rejected: Overly complex for simple error display

Current approach (capture-display-rethrow) is the simplest solution that maintains existing architecture.

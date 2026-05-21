# Components & API Reference

Directory of reusable components, utilities, and public APIs in SC8P053VM.

**Purpose**: Avoid reinventing the wheel. Check here before implementing functionality.

---

## Public API (Exported from package)

### VM Class - Virtual Machine Core

**Import**: `import { VM } from 'sc8p053vm'`

**Source**: `src/vm.ts`

#### Constructor

```typescript
constructor(romData: Uint16Array, config?: {
  wdt?: boolean;      // Enable watchdog timer (default: false)
  lvrSel?: number;    // Low voltage reset selection (0x00-0x03)
  fcpuDiv?: number;   // CPU clock divider (2 or 4, default: 4)
})
```

**Example**:
```typescript
const rom = new Uint16Array([0x2800, 0x0008]); // Simple program
const vm = new VM(rom, { wdt: false, fcpuDiv: 4 });
```

#### Methods

##### `run(maxCycles?: number, stepCallback?: () => void): void`

Execute VM for specified number of cycles.

**Parameters**:
- `maxCycles` - Maximum cycles to execute (optional, unlimited if omitted)
- `stepCallback` - Called after each instruction execution (optional)

**Example**:
```typescript
// Run indefinitely
vm.run();

// Run up to 10000 cycles
vm.run(10000);

// Run with callback
vm.run(1000, () => {
  console.log('Executed one instruction');
});
```

##### `reset(): void`

Reset VM to initial state (power-on reset).

**Example**:
```typescript
vm.reset();
```

##### `getState(): VMState`

Get current VM state snapshot.

**Returns**:
```typescript
interface VMState {
  pc: number;           // Program counter
  acc: number;          // Accumulator
  sp: number;           // Stack pointer
  status: number;       // STATUS register
  ram: Uint8Array;      // RAM contents (copy)
  stack: Uint16Array;   // Stack contents
  cycles: number;       // Total cycles executed
}
```

**Example**:
```typescript
const state = vm.getState();
console.log('PC:', state.pc.toString(16));
console.log('ACC:', state.acc.toString(16));
```

##### `setPinInput(port: 'A' | 'B', pin: number, value: boolean): void`

Set I/O pin input value (simulate external signal).

**Parameters**:
- `port` - Port name ('A' or 'B')
- `pin` - Pin number (0-7)
- `value` - Logic level (true=high, false=low)

**Example**:
```typescript
vm.setPinInput('A', 0, true);  // PORTA bit 0 high
vm.setPinInput('B', 3, false); // PORTB bit 3 low
```

##### `setComparatorInput(pin: string, normalizedValue: number): void`

Set comparator analog input voltage.

**Parameters**:
- `pin` - Comparator input ('CMP_PLUS' or 'CMP_MINUS')
- `normalizedValue` - Voltage as fraction of VDD (0.0 to 1.0)

**Example**:
```typescript
vm.setComparatorInput('CMP_PLUS', 0.5); // 50% of VDD
```

##### `setLSEEnabled(enable: boolean): void`

Enable/disable low-speed external oscillator (32.768kHz).

**Example**:
```typescript
vm.setLSEEnabled(true);
```

##### `setT0CKIFrequency(frequencyHz: number): void`

Set T0CKI external clock frequency for Timer0.

**Example**:
```typescript
vm.setT0CKIFrequency(1000); // 1kHz external clock
```

##### `setVDD(voltage: number): void`

Set supply voltage (affects LVR behavior).

**Example**:
```typescript
vm.setVDD(3.3); // 3.3V supply
```

#### Callbacks

##### `ioCallback?: (ports: { A: number; B: number }) => void`

Called when I/O port state changes.

**Example**:
```typescript
vm.ioCallback = (ports) => {
  console.log('Port A:', ports.A.toString(16));
  console.log('Port B:', ports.B.toString(16));
};
```

---

### compile() Function - C Compiler

**Import**: `import { compile } from 'sc8p053vm'`

**Source**: `src/cc.ts`

#### Signature

```typescript
async function compile(code: string): Promise<{
  rom: Uint16Array;
  debugInfo: DebugInfo;
}>
```

**Parameters**:
- `code` - C source code as string

**Returns**:
- `rom` - Machine code array
- `debugInfo` - Debugging information

#### DebugInfo Interface

```typescript
interface DebugInfo {
  lineNoMap: Map<number, number>;              // PC → line number
  fnRanges: Map<string, Array<{                // Function ranges
    start: number;
    end: number;
  }>>;
  varMap: Map<string, Array<{                  // Variable symbols
    name: string;
    ramAddr: number;
    typeInfo: {
      isArray: boolean;
      arraySize?: number;
    };
  }>>;
}
```

#### Example

```typescript
const cCode = `
void main() {
  char x = 10;
  char y = 20;
  char z = x + y;
  
  while(1) {
    // Infinite loop
  }
}
`;

const { rom, debugInfo } = await compile(cCode);

// Create VM with compiled code
const vm = new VM(rom);

// Get function range
const mainRange = debugInfo.fnRanges.get('main')?.[0];
if (mainRange) {
  console.log('main() starts at PC:', mainRange.start);
}

// Get variable info
const vars = debugInfo.varMap.get('main') || [];
vars.forEach(v => {
  console.log(`${v.name} at RAM address: 0x${v.ramAddr.toString(16)}`);
});
```

#### Supported C Features

✅ **Supported**:
- Basic types: `unsigned char`, `signed char`, `char`, `bool`, `void`, `int` (8-bit)
- Typedef: global/local typedef, pointers, arrays, chaining, function params
- Arrays: 1D, 2D, 3D with initialization, variable indices, compound assignment
- Pointers: declaration, dereference, address-of, arithmetic, function params
- Functions: definition, calls, return values (including pointer returns), ISR
- Control flow: `if`/`else`, `while`, `do-while`, `for`, `switch`/`case`, `break`, `continue`
- goto/label: forward/backward jumps, loop/switch exit, label validation
- Preprocessor: `#define`, `#include`, `#if`/`#elif`/`#else`/`#endif`, `#ifdef`/`#ifndef`, `#error`
- Variables: local, global, static local, `sizeof`
- Operators: arithmetic, bitwise, comparison, logical, shift, compound assignment, ternary
- Increment/decrement: pre and post `++`/`--`

❌ **Not Supported**:
- `struct`, `enum`, `union`
- Dynamic memory (`malloc`/`free`)
- Floating point (`float`, `double`)
- Recursion (static RAM allocation)
- Function pointers
- Standard library functions
- Multi-file compilation
- Typedef cast syntax `(typedef_name)value`

---

### assemble() Function - Assembler

**Import**: `import { assemble } from 'sc8p053vm'`

**Source**: `src/asmc.ts`

#### Signature

```typescript
function assemble(asmCode: string): Uint16Array
```

**Parameters**:
- `asmCode` - Assembly code as string

**Returns**:
- Machine code array

#### Example

```typescript
const asmCode = `
    ORG 0x00
    MOVLW 0x0A
    MOVWF 0x20
    GOTO $
`;

const rom = assemble(asmCode);
const vm = new VM(rom);
vm.run();
```

---

## Internal Utilities (Not Exported)

These are internal implementation details but may be useful for understanding the system.

### VM Internal Constants

Located in `src/vm.ts`:

```typescript
// Memory sizes
VM.RAM_SIZE = 0x100        // 256 bytes
VM.STACK_SIZE = 8          // 8-level stack

// Oscillator frequencies
VM.FHSI = 16_000_000       // 16MHz internal
VM.FLSE = 32_768           // 32.768kHz external

// SFR addresses (Bank 0)
VM.SFR_INDF = 0x00
VM.SFR_OPTION_REG = 0x01
VM.SFR_PCL = 0x02
VM.SFR_STATUS = 0x03
// ... (many more)

// STATUS register bits
VM.STATUS_RP1 = 0x40
VM.STATUS_RP0 = 0x20
VM.STATUS_TO = 0x10
VM.STATUS_PD = 0x08
VM.STATUS_Z = 0x04
VM.STATUS_DC = 0x02
VM.STATUS_C = 0x01
```

### Instruction Opcodes

The VM supports 47 SC8P053 instructions including:
- Data movement: MOVLW, MOVWF, MOVF, CLRF, CLRW
- Arithmetic: ADDLW, ADDWF, SUBLW, SUBWF
- Logic: ANDLW, ANDWF, IORLW, IORWF, XORLW, XORWF
- Bit manipulation: BCF, BSF, BTFSC, BTFSS
- Control flow: GOTO, CALL, RETURN, RETLW
- Special: NOP, CLRWDT, SLEEP

See `src/vm.ts` for complete opcode table.

---

## Frontend Components (example/src/index.tsx)

These are React components used in the debugger UI. Not part of the npm package.

### App Component

Main application component managing debugger state.

**State Structure**:
```typescript
interface AppState {
  code: string;                    // Source code
  vm: VM | null;                   // VM instance
  debugInfo: DebugInfo | null;     // Debug symbols
  currentLine?: number;            // Current execution line
  breakpoints: Set<number>;        // Active breakpoints
  isBreakpointsEnabled: boolean;   // Breakpoint toggle
  isRunning: boolean;              // Execution state
  ports: { A: number; B: number }; // I/O states
}
```

**Key Methods**:
- `compileCode()` - Compile current code
- `run()` - Start execution
- `pause()` - Pause execution
- `step()` - Execute one instruction
- `reset()` - Reset VM
- `stop()` - Stop and clear VM
- `toggleBreakpoint(line)` - Toggle breakpoint
- `togglePinInput(port, pin)` - Toggle I/O pin

**Keyboard Shortcuts**:
- `Ctrl+Shift+F5` - Reset
- `Shift+F5` - Stop
- `F5` - Run
- `F6` - Pause
- `F9` - Toggle breakpoint
- `F10` - Step over

---

## Common Patterns & Recipes

### Pattern 1: Compile and Run C Code

```typescript
import { VM, compile } from 'sc8p053vm';

async function runCCode(code: string) {
  const { rom } = await compile(code);
  const vm = new VM(rom);
  vm.run(10000);
  return vm.getState();
}
```

### Pattern 2: Monitor I/O Changes

```typescript
const vm = new VM(rom);

vm.ioCallback = (ports) => {
  // React to port changes
  if (ports.A & 0x01) {
    console.log('PORTA bit 0 is HIGH');
  }
};

vm.run();
```

### Pattern 3: Step-by-Step Debugging

```typescript
const vm = new VM(rom);

let steps = 0;
vm.run(100, () => {
  steps++;
  const state = vm.getState();
  console.log(`Step ${steps}: PC=${state.pc.toString(16)}`);
});
```

### Pattern 4: Set Breakpoint Logic

```typescript
const TARGET_LINE = 42;

vm.run(undefined, () => {
  const state = vm.getState();
  const currentLine = debugInfo.lineNoMap.get(state.pc);
  
  if (currentLine === TARGET_LINE) {
    console.log('Breakpoint hit!');
    // Pause execution logic here
  }
});
```

### Pattern 5: Simulate External Input

```typescript
const vm = new VM(rom);

// Simulate button press on PORTB bit 0
vm.setPinInput('B', 0, true);

// Run until input is detected
vm.run(10000);
```

---

## Performance Tips

### VM Execution
- Use `maxCycles` parameter to limit execution time
- Avoid infinite loops without cycle limits
- Minimize `stepCallback` overhead (it's called every instruction)

### Compilation
- Cache compiled ROM if code doesn't change
- Compilation is async - use `await` properly
- Large files take longer to compile

### Debugger UI
- Limit update frequency in stepCallback
- Use requestAnimationFrame for smooth rendering
- Debounce syntax highlighting for large files

---

## Error Handling

### Common Errors

**"Invalid opcode"**
- Cause: Corrupted ROM data
- Fix: Verify compilation succeeded

**"Pin out of range"**
- Cause: Pin number not 0-7
- Fix: Check pin parameter

**"Compilation failed"**
- Cause: Syntax error in C code
- Fix: Check error messages from compiler

### Best Practices

```typescript
try {
  const { rom } = await compile(code);
  const vm = new VM(rom);
  vm.run(10000);
} catch (error) {
  console.error('Execution failed:', error);
  // Handle error appropriately
}
```

---

## Testing Examples

### Unit Test for VM

```typescript
import { describe, it, expect } from 'vitest';
import { VM } from 'sc8p053vm';

describe('VM', () => {
  it('should execute NOP instruction', () => {
    const rom = new Uint16Array([0x0000]); // NOP
    const vm = new VM(rom);
    vm.run(1);
    
    const state = vm.getState();
    expect(state.pc).toBe(1);
    expect(state.cycles).toBe(1);
  });
});
```

### Integration Test for Compiler + VM

```typescript
import { describe, it, expect } from 'vitest';
import { VM, compile } from 'sc8p053vm';

describe('Compiler + VM Integration', () => {
  it('should compile and run simple C code', async () => {
    const code = 'void main() { char x = 42; }';
    const { rom } = await compile(code);
    
    const vm = new VM(rom);
    vm.run(100);
    
    expect(vm.getState().cycles).toBeGreaterThan(0);
  });
});
```

---

## Migration Guide

### Upgrading from v1.0.x to v1.1.x

Check RELEASE-NOTES.md for breaking changes.

### Deprecated APIs

None currently deprecated.

---

## Contributing New Components

When adding new reusable utilities:

1. **Document here** - Add to this file
2. **Write tests** - Ensure reliability
3. **Add JSDoc** - Clear API documentation
4. **Export publicly** - If useful to users
5. **Update INDEX.md** - Link to relevant docs

---

## Quick Search

Looking for something specific?

- **Execute code**: See `VM.run()`
- **Compile C**: See `compile()`
- **Debug info**: See `DebugInfo` interface
- **I/O control**: See `VM.setPinInput()`
- **State inspection**: See `VM.getState()`
- **Assembly**: See `assemble()`

---

**Last Updated**: 2026-05-11
**Maintained By**: Project team

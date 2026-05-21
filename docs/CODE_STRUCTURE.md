# Code Structure

Complete module map and architecture documentation for SC8P053VM.

## Project Structure Overview

```
sc8p053vm/
├── src/                      # Core source code
│   ├── index.ts              # Module exports (public API)
│   ├── vm.ts                 # Virtual Machine core (~2074 lines)
│   ├── cc.ts                 # C Compiler (~6890 lines)
│   ├── asmc.ts               # Assembler (~564 lines)
│   ├── cc-test.js            # Comprehensive test suite (740 test cases)
│   └── cc-test.md            # Bug tracking and test documentation (105 bugs)
│
├── example/                  # Frontend debugger example
│   ├── src/
│   │   ├── index.tsx         # React debugger UI
│   │   └── styles.css        # UI styles
│   ├── public/               # Static assets
│   │   ├── main.c            # Sample C code
│   │   └── ...               # Compiled outputs
│   ├── doc/                  # Documentation & examples
│   └── webpack.config.js     # Build configuration
│
├── dist/                     # Compiled output (generated)
│   ├── index.js              # Main entry point
│   ├── index.d.ts            # Type definitions
│   ├── vm.js                 # VM module
│   ├── cc.js                 # Compiler module
│   └── asmc.js               # Assembler module
│
├── docs/                     # Documentation
│   ├── INDEX.md              # Documentation map
│   ├── ONBOARDING.md         # Getting started guide
│   ├── CODE_STRUCTURE.md     # This file
│   ├── WORKFLOW.md           # Development workflow
│   ├── COMPONENTS.md         # API reference
│   ├── superpowers/
│   │   ├── specs/            # Design documents
│   │   └── plans/            # Implementation plans
│   └── decisions/            # Architecture decisions
│
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript configuration
└── README.md                 # Project overview
```

---

## Core Modules

### 1. VM (Virtual Machine) - `src/vm.ts`

**Purpose**: Simulates SC8P053 microcontroller hardware behavior

**Size**: ~2300 lines (largest module)

**Responsibilities**:
- Execute SC8P053 instruction set (47 instructions)
- Simulate CPU registers (ACC, PC, SP, STATUS)
- Manage memory (256 bytes RAM, 8-level stack)
- Emulate peripherals:
  - Timers (TMR0, TMR2)
  - PWM modules (PWM0-PWM4)
  - Comparators (CMP)
  - I/O ports (PORTA, PORTB)
  - Interrupt system
  - Watchdog timer (WDT)
  - Low voltage reset (LVR)
  - Power-down modes

**Key Classes**:
```typescript
class VM {
  constructor(romData: Uint16Array, config?: VMConfig)
  
  // Execution
  run(maxCycles?: number, stepCallback?: () => void): void
  reset(): void
  getState(): VMState
  
  // I/O Control
  setPinInput(port: 'A' | 'B', pin: number, value: boolean): void
  setComparatorInput(pin: string, normalizedValue: number): void
  setLSEEnabled(enable: boolean): void
  setT0CKIFrequency(frequencyHz: number): void
  setVDD(voltage: number): void
  
  // Callbacks
  ioCallback?: (ports: { A: number; B: number }) => void
}
```

**Dependencies**: None (self-contained)

**Usage Example**:
```typescript
import { VM } from 'sc8p053vm';

const rom = new Uint16Array([/* machine code */]);
const vm = new VM(rom, { wdt: false, fcpuDiv: 4 });

vm.ioCallback = (ports) => {
  console.log('Port A:', ports.A.toString(16));
  console.log('Port B:', ports.B.toString(16));
};

vm.run(10000); // Run up to 10000 cycles
const state = vm.getState();
console.log('PC:', state.pc);
```

**Internal Architecture**:
- Instruction decoder → Execute specific opcode
- Memory bank switching (RP0, RP1 bits)
- Peripheral state machines (timers, PWM)
- Interrupt priority handling
- Clock cycle counting

---

### 2. C Compiler - `src/cc.ts`

**Purpose**: Compile C code to SC8P053 machine code

**Size**: ~6890 lines (largest and most complex module)

**Responsibilities**:
- Parse C code using tree-sitter
- Preprocessor (#define, #include, #if/#ifdef, #error)
- Semantic analysis and type checking (including typedef)
- Generate intermediate representation
- Optimize code for SC8P053 constraints
- Emit machine code (Uint16Array)
- Generate debug information

**Key Functions**:
```typescript
export async function compile(code: string): Promise<{
  rom: Uint16Array;      // Machine code
  debugInfo: DebugInfo;  // Debug symbols
}>

interface DebugInfo {
  lineNoMap: Map<number, number>;      // PC → line number
  fnRanges: Map<string, Array<{start: number, end: number}>>;  // Function ranges
  varMap: Map<string, Symbol[]>;       // Variable symbols
}
```

**Dependencies**:
- `web-tree-sitter` - C parser
- `tree-sitter-c` - C grammar

**Compilation Pipeline**:
1. **Preprocessing** - Macro expansion, conditional compilation, #error handling
2. **Parsing** - tree-sitter parses preprocessed C code into AST
3. **Semantic Analysis** - Type checking, typedef resolution, scope management
4. **Code Generation** - Emit SC8P053 instructions with optimization
5. **Debug Info** - Generate symbol tables and line number maps

**Supported C Features**:
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

**Limitations**:
- No `struct`, `enum`, `union` support
- No dynamic memory allocation (malloc/free)
- No recursion (static RAM allocation, limited stack)
- No floating point (integer only)
- No function pointers
- No standard library functions
- No multi-file compilation
- All `int` types are 8-bit (target MCU constraint)
- `(typedef_name)value` cast syntax not supported (tree-sitter limitation)
- Pointer arrays (`typedef *T; T arr[N]`) have type resolution issues

**Usage Example**:
```typescript
import { compile } from 'sc8p053vm';

const cCode = `
void main() {
  char x = 10;
  char y = 20;
  char z = x + y;
}
`;

const { rom, debugInfo } = await compile(cCode);
const vm = new VM(rom);
vm.run();
```

---

### 3. Assembler - `src/asmc.ts`

**Purpose**: Process assembly code and generate machine code

**Size**: ~600 lines

**Responsibilities**:
- Parse assembly syntax
- Resolve labels and addresses
- Generate machine code
- Handle directives (.org, .db, etc.)

**Key Functions**:
```typescript
export function assemble(asmCode: string): Uint16Array
```

**Dependencies**: None

**Usage**: Primarily used internally by compiler or for direct assembly programming

---

### 4. Module Exports - `src/index.ts`

**Purpose**: Public API surface for the package

**Content**:
```typescript
export { VM } from './vm';
export { compile } from './cc';
export { assemble } from './asmc';
export type { DebugInfo } from './cc';
```

**This is what users import**:
```typescript
import { VM, compile } from 'sc8p053vm';
```

---

## Frontend Debugger

### React Application - `example/src/index.tsx`

**Purpose**: Interactive debugger UI for visualizing VM execution

**Size**: ~460 lines

**Technology Stack**:
- React 18
- TypeScript
- highlight.js (syntax highlighting)
- Webpack (bundler)

**Components**:
- **App** (main component)
  - Debug control bar (run, pause, step, reset, stop)
  - Code editor with breakpoints
  - State panel (registers, memory, I/O)
  - Status bar (CPU cycles)

**Features**:
- Real-time code execution visualization
- Breakpoint management (F9)
- Step-through debugging (F10)
- Register/memory inspection
- I/O port interaction (clickable pins)
- Syntax highlighting for C code
- Keyboard shortcuts (F5, F6, F9, F10)

**State Management**:
```typescript
interface AppState {
  code: string;                    // Source code
  vm: VM | null;                   // VM instance
  debugInfo: DebugInfo | null;     // Debug symbols
  currentLine?: number;            // Current execution line
  breakpoints: Set<number>;        // Active breakpoints
  isRunning: boolean;              // Execution state
  ports: { A: number; B: number }; // I/O port states
}
```

**Execution Flow**:
1. Load C code from `public/main.c`
2. Compile code using `compile()` function
3. Create VM instance with compiled ROM
4. Run VM with requestAnimationFrame loop
5. Update UI on each instruction execution
6. Check breakpoints and pause when hit

**Keyboard Shortcuts**:
- `Ctrl+Shift+F5` - Reset
- `Shift+F5` - Stop
- `F5` - Run
- `F6` - Pause
- `F9` - Toggle breakpoint
- `F10` - Step over

---

## Data Flow

### Compilation Flow
```
C Code (string)
    ↓
[cc.ts: compile()]
    ↓ tree-sitter parsing
AST (Abstract Syntax Tree)
    ↓ semantic analysis
Typed AST
    ↓ code generation
Machine Code (Uint16Array) + DebugInfo
    ↓
[vm.ts: VM constructor]
    ↓
VM Instance (ready to execute)
```

### Execution Flow
```
VM.run()
    ↓
Fetch instruction from ROM[PC]
    ↓
Decode opcode
    ↓
Execute instruction
    ↓
Update registers/memory
    ↓
Check interrupts
    ↓
Increment cycles
    ↓
stepCallback() (if provided)
    ↓
Repeat until maxCycles or HALT
```

### Debugging Flow
```
User clicks "Run" button
    ↓
Compile C code (if not compiled)
    ↓
Create VM instance
    ↓
Start execution loop (requestAnimationFrame)
    ↓
Each instruction:
  - Update currentLine from debugInfo
  - Check breakpoints
  - Update UI state (registers, memory)
  - Render code highlighting
    ↓
Pause at breakpoint or user action
```

---

## Module Dependencies

```
index.ts (exports)
├── vm.ts (no dependencies)
├── cc.ts
│   ├── web-tree-sitter (peer dependency)
│   └── tree-sitter-c (peer dependency)
└── asmc.ts (no dependencies)

example/src/index.tsx
├── sc8p053vm (local package)
├── react
├── react-dom
└── highlight.js
```

---

## Key Design Decisions

### 1. Why Separate VM and Compiler?
- **Separation of concerns**: VM simulates hardware, compiler translates code
- **Reusability**: VM can execute any machine code, not just compiled C
- **Testing**: Can test VM with known-good machine code
- **Flexibility**: Support multiple input languages (C, assembly)

### 2. Why Use tree-sitter?
- **Accurate parsing**: Better than regex-based approaches
- **Error recovery**: Handles incomplete/invalid code gracefully
- **Language support**: Easy to add other languages
- **Performance**: Fast incremental parsing

### 3. Why React for Debugger?
- **Component model**: Natural fit for UI components
- **State management**: Declarative UI updates
- **Ecosystem**: Rich library of UI components
- **Type safety**: TypeScript integration

### 4. Why web-tree-sitter instead of tree-sitter?
- **Browser compatibility**: Native tree-sitter doesn't work in browsers
- **WASM support**: web-tree-sitter uses WebAssembly
- **Same API**: Drop-in replacement with minimal changes

---

## Performance Considerations

### VM Performance
- **Instruction execution**: ~1μs per instruction (JavaScript)
- **Memory access**: O(1) array lookups
- **Peripheral simulation**: Adds overhead for timers/PWM
- **Optimization**: Minimize object allocations in hot paths

### Compiler Performance
- **Parsing**: tree-sitter is fast (~ms for typical files)
- **Code generation**: Dominates compilation time
- **Optimization**: Trade-off between speed and code quality

### Debugger Performance
- **UI updates**: requestAnimationFrame limits to 60fps
- **Large files**: Syntax highlighting can be slow
- **Optimization**: Only re-render changed components

---

## Testing Strategy

### Current State
- **cc-test.js**: 740 comprehensive test cases covering compiler features
- **cc-test.md**: Detailed bug tracking (105 bugs found and fixed)
- **Jest (cc.test.ts)**: 25 unit tests for core compiler functionality
- Manual testing via debugger UI

### Test Coverage by Feature
- **Basic operations**: arithmetic, bitwise, comparison, logical
- **Types**: unsigned char, signed char, bool, int
- **Typedef**: basic, pointer, array, chaining, local scope, function params, redefinition
- **Arrays**: 1D, 2D, 3D, initialization, variable indices, compound assignment
- **Pointers**: declaration, dereference, address-of, arithmetic, function params
- **Control flow**: if/else, while, do-while, for, switch, break, continue
- **goto/label**: forward/backward jumps, loop exit, label validation
- **Preprocessor**: #define, #include, #if/#ifdef, #error, nested conditionals
- **Functions**: params, return values, ISR, pointer returns
- **Error detection**: type errors, undefined symbols, invalid operations

---

## Extending the System

### Adding New Instructions
1. Add opcode constant in `vm.ts`
2. Implement execution logic
3. Add to instruction decoder
4. Write tests
5. Update documentation

### Adding New Peripherals
1. Define SFR addresses
2. Implement state machine
3. Integrate with interrupt system
4. Add I/O callbacks
5. Update debugger UI

### Supporting New Languages
1. Add tree-sitter grammar
2. Implement code generator
3. Create language-specific optimizations
4. Add to compiler pipeline
5. Update documentation

---

## Common Patterns

### Error Handling
```typescript
// Throw descriptive errors
throw new Error(`Invalid opcode: ${opcode}`);

// Validate inputs
if (pin < 0 || pin > 7) {
  throw new RangeError(`Pin must be 0-7, got ${pin}`);
}
```

### State Management
```typescript
// Immutable state snapshots
getState(): VMState {
  return {
    pc: this.pc,
    acc: this.acc,
    ram: new Uint8Array(this.ram),  // Copy, not reference
    // ...
  };
}
```

### Callbacks
```typescript
// Optional callbacks for extensibility
ioCallback?: (ports: { A: number; B: number }) => void;

// Call if defined
if (this.ioCallback) {
  this.ioCallback({ A: this.portA, B: this.portB });
}
```

---

## Glossary

- **SFR**: Special Function Register (hardware control registers)
- **ROM**: Read-only memory (program storage)
- **RAM**: Random-access memory (data storage)
- **PC**: Program Counter (current instruction address)
- **ACC**: Accumulator (primary register)
- **SP**: Stack Pointer
- **PWM**: Pulse Width Modulation
- **WDT**: Watchdog Timer
- **LVR**: Low Voltage Reset
- **SFR**: Special Function Register

---

**Last Updated**: 2026-05-21
**Maintained By**: Project team

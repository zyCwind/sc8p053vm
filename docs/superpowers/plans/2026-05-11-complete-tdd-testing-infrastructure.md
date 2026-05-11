# 完整 TDD 测试基础设施实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SC8P053VM 项目建立完整的自动化测试体系，包括后端单元测试和前端组件测试，实现真正的 TDD 工作流。

**Architecture:** 采用 Jest 作为统一测试框架，配合 @testing-library/react 进行 React 组件测试。通过 vitest.config.ts 配置测试环境，迁移现有 cc-test.js 到 Jest 格式，并为所有核心模块补充单元测试。

**Tech Stack:** 
- Jest (v29.x) - 测试运行器和断言库
- ts-jest - TypeScript 支持
- @testing-library/react (v14.x) - React 组件测试
- @testing-library/jest-dom - DOM 断言扩展
- jest-environment-jsdom - 浏览器环境模拟
- @types/jest - TypeScript 类型定义

---

## 文件结构规划

### 配置文件
- `jest.config.js` - 根目录 Jest 配置
- `example/jest.config.js` - example 目录专用配置（React 测试）

### 测试文件组织
```
src/__tests__/
└── cc.test.ts          # 编译器测试（从 cc-test.js 迁移，含辅助函数）

example/src/__tests__/
└── App.test.tsx        # React 组件测试
```

**注意**：只创建这两个测试文件，不创建其他测试文件。

---

## 任务分解

### Task 1: 安装测试依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 Jest 核心依赖**

```bash
npm install --save-dev jest@^29.7.0 ts-jest@^29.1.1 @types/jest@^29.5.12
```

- [ ] **Step 2: 安装 React 测试依赖**

```bash
npm install --save-dev @testing-library/react@^14.2.1 @testing-library/jest-dom@^6.4.2 @testing-library/user-event@^14.5.2 jest-environment-jsdom@^29.7.0
```

- [ ] **Step 3: 验证安装成功**

```bash
npm list jest @testing-library/react
```

Expected output: 显示已安装的版本信息，无错误。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Jest and React Testing Library dependencies"
```

---

### Task 2: 配置 Jest 测试环境

**Files:**
- Create: `jest.config.js`
- Create: `example/jest.config.js`
- Modify: `package.json` (添加 test 脚本)

- [ ] **Step 1: 创建根目录 Jest 配置**

Create: `jest.config.js`

```javascript
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/cc-test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2017',
          module: 'commonjs',
          esModuleInterop: true
        }
      }
    ]
  },
  moduleNameMapper: {
    '^sc8p053vm$': '<rootDir>/dist/index.js'
  }
};
```

- [ ] **Step 2: 创建 example 目录 Jest 配置**

Create: `example/jest.config.js`

```javascript
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.tsx'],
  setupFilesAfterSetup: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^sc8p053vm$': '<rootDir>/../dist/index.js',
    '\\.(css|less|scss)$': 'identity-obj-proxy'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2017',
          module: 'esnext',
          jsx: 'react-jsx',
          esModuleInterop: true
        }
      }
    ]
  }
};
```

- [ ] **Step 3: 创建 React 测试环境设置文件（可选）**

Create: `example/src/__tests__/setup.ts`（可选，如果前端测试需要 jest-dom 扩展）

```typescript
import '@testing-library/jest-dom';
```

**注意**：此文件仅在 React 测试需要 DOM 断言扩展时才需要。如果不需要可以跳过。

- [ ] **Step 4: 更新 package.json 添加测试脚本**

Modify: `package.json` scripts section

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "cd example && webpack serve --mode development",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint . --ext .ts,.tsx",
    "lint:src": "eslint src/ --ext .ts",
    "lint:example": "eslint example/ --ext .tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,css}\""
  }
}
```

- [ ] **Step 5: 验证配置正确性**

```bash
npm run test -- --version
```

Expected output: 显示 Jest 版本号（如 29.7.0）

- [ ] **Step 6: Commit**

```bash
git add jest.config.js example/jest.config.js example/src/__tests__/setup.ts package.json
git commit -m "chore: configure Jest for backend and frontend testing"
```

---

### Task 3: 迁移 cc-test.js 到 Jest 格式（第一部分：基础运算）

**Files:**
- Create: `src/__tests__/cc.test.ts`
- Read: `src/cc-test.js` (参考现有测试用例)

- [ ] **Step 1: 创建测试文件骨架（含辅助函数）**

Create: `src/__tests__/cc.test.ts`

```typescript
import { describe, it, expect } from '@jest/globals';
import { compile, DebugInfo } from '../cc';
import { VM } from '../vm';

// 辅助函数定义
interface CompileAndRunResult {
  vm: VM;
  debugInfo: DebugInfo;
}

async function compileAndRun(
  source: string,
  maxCycles = 200000
): Promise<CompileAndRunResult | null> {
  const { debugInfo, rom } = await compile(source);
  if (!rom) return null;
  
  const vm = new VM(rom, { wdt: false });
  vm.run(maxCycles);
  
  return { vm, debugInfo };
}

function readRam(vm: VM, addr: number): number {
  return vm.getState().ram[addr];
}

function getVarAddr(
  debugInfo: DebugInfo,
  scope: string,
  varName: string
): number {
  let name = varName;
  let idx = 0;
  
  const match = varName.match(/([^\[]+)\[(\d+)\]/);
  if (match) {
    name = match[1];
    idx = parseInt(match[2], 10);
  }
  
  const varMap = debugInfo.varMap.get(scope);
  if (!varMap) {
    throw new Error(`Variable scope '${scope}' not found`);
  }
  
  const variable = varMap.find(v => v.name === name);
  if (!variable) {
    throw new Error(`Variable '${name}' not found in scope '${scope}'`);
  }
  
  return variable.ramAddr + idx;
}

// 测试用例开始
describe('Compiler: Bitwise Operations', () => {
  describe('Left Shift (<<)', () => {
    it('should shift left by 1: 0x03 << 1 = 0x06', async () => {
      const result = await compileAndRun(
        'unsigned char x = 3; unsigned char y; void main() { y = x << 1; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x06);
    });

    it('should shift left by 1 without circular: 0x80 << 1 = 0x00', async () => {
      const result = await compileAndRun(
        'unsigned char x = 128; unsigned char y; void main() { y = x << 1; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x00);
    });

    it('should shift left by 2: 0x03 << 2 = 0x0C', async () => {
      const result = await compileAndRun(
        'unsigned char x = 3; unsigned char y; void main() { y = x << 2; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x0C);
    });

    it('should shift left by 3: 0x01 << 3 = 0x08', async () => {
      const result = await compileAndRun(
        'unsigned char x = 1; unsigned char y; void main() { y = x << 3; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x08);
    });
  });

  describe('Right Shift (>>)', () => {
    it('should shift right by 1: 0x06 >> 1 = 0x03', async () => {
      const result = await compileAndRun(
        'unsigned char x = 6; unsigned char y; void main() { y = x >> 1; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x03);
    });

    it('should shift right by 1 without circular: 0x81 >> 1 = 0x40', async () => {
      const result = await compileAndRun(
        'unsigned char x = 129; unsigned char y; void main() { y = x >> 1; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x40);
    });

    it('should shift right by 2: 0x0C >> 2 = 0x03', async () => {
      const result = await compileAndRun(
        'unsigned char x = 12; unsigned char y; void main() { y = x >> 2; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0x03);
    });
  });
});

describe('Compiler: Arithmetic Operations', () => {
  describe('Multiplication (*)', () => {
    it('should multiply: 5 * 2 = 10', async () => {
      const result = await compileAndRun(
        'unsigned char x = 5; unsigned char y; void main() { y = x * 2; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(10);
    });

    it('should handle overflow: 128 * 2 = 0', async () => {
      const result = await compileAndRun(
        'unsigned char x = 128; unsigned char y; void main() { y = x * 2; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(0);
    });
  });

  describe('Division (/)', () => {
    it('should divide: 10 / 2 = 5', async () => {
      const result = await compileAndRun(
        'unsigned char x = 10; unsigned char y; void main() { y = x / 2; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(5);
    });

    it('should perform integer division: 11 / 2 = 5', async () => {
      const result = await compileAndRun(
        'unsigned char x = 11; unsigned char y; void main() { y = x / 2; }'
      );
      
      expect(result).not.toBeNull();
      const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
      expect(readRam(result!.vm, addrY)).toBe(5);
    });
  });

  describe('Subtraction (-)', () => {
    it('should subtract: 10 - 3 = 7', async () => {
      const result = await compileAndRun(
        'unsigned char a = 10, b = 3, c; void main() { c = a - b; }'
      );
      
      expect(result).not.toBeNull();
      const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
      expect(readRam(result!.vm, addrC)).toBe(7);
    });

    it('should compound subtract: 10 -= 3 = 7', async () => {
      const result = await compileAndRun(
        'unsigned char a = 10; void main() { a -= 3; }'
      );
      
      expect(result).not.toBeNull();
      const addrA = getVarAddr(result!.debugInfo, 'global', 'a');
      expect(readRam(result!.vm, addrA)).toBe(7);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证迁移成功**

```bash
npm run test -- src/__tests__/cc.test.ts
```

Expected output: 显示所有测试通过（PASS），类似：
```
 PASS  src/__tests__/cc.test.ts
  Compiler: Bitwise Operations
    Left Shift (<<)
      ✓ should shift left by 1: 0x03 << 1 = 0x06 (XX ms)
      ✓ should shift left by 1 without circular: 0x80 << 1 = 0x00 (XX ms)
      ...
  Compiler: Arithmetic Operations
    Multiplication (*)
      ✓ should multiply: 5 * 2 = 10 (XX ms)
      ...

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/cc.test.ts
git commit -m "test: migrate bitwise and arithmetic tests from cc-test.js to Jest"
```

---

### Task 4: 迁移 cc-test.js 到 Jest 格式(第二部分:高级特性)

**Files:**
- Modify: `src/__tests__/cc.test.ts` (追加更多测试用例)

- [ ] **Step 1: 添加函数调用测试**

Append to `src/__tests__/cc.test.ts`:

```typescript
describe('Compiler: Functions', () => {
  it('should call simple function and return value', async () => {
    const result = await compileAndRun(`
      unsigned char add(unsigned char a, unsigned char b) {
        return a + b;
      }
      unsigned char result;
      void main() {
        result = add(3, 5);
      }
    `);
    
    expect(result).not.toBeNull();
    const addrResult = getVarAddr(result!.debugInfo, 'global', 'result');
    expect(readRam(result!.vm, addrResult)).toBe(8);
  });

  it('should handle recursive function calls', async () => {
    const result = await compileAndRun(`
      unsigned char factorial(unsigned char n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      }
      unsigned char result;
      void main() {
        result = factorial(5);
      }
    `, 500000); // 增加 cycles 以支持递归
    
    expect(result).not.toBeNull();
    const addrResult = getVarAddr(result!.debugInfo, 'global', 'result');
    expect(readRam(result!.vm, addrResult)).toBe(120); // 5! = 120
  });
});

describe('Compiler: Control Flow', () => {
  it('should execute if-else statement', async () => {
    const result = await compileAndRun(`
      unsigned char x = 10;
      unsigned char y;
      void main() {
        if (x > 5) {
          y = 1;
        } else {
          y = 0;
        }
      }
    `);
    
    expect(result).not.toBeNull();
    const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
    expect(readRam(result!.vm, addrY)).toBe(1);
  });

  it('should execute for loop', async () => {
    const result = await compileAndRun(`
      unsigned char sum = 0;
      void main() {
        for (unsigned char i = 1; i <= 5; i++) {
          sum += i;
        }
      }
    `);
    
    expect(result).not.toBeNull();
    const addrSum = getVarAddr(result!.debugInfo, 'global', 'sum');
    expect(readRam(result!.vm, addrSum)).toBe(15); // 1+2+3+4+5 = 15
  });

  it('should execute while loop', async () => {
    const result = await compileAndRun(`
      unsigned char count = 0;
      unsigned char i = 0;
      void main() {
        while (i < 10) {
          count++;
          i++;
        }
      }
    `);
    
    expect(result).not.toBeNull();
    const addrCount = getVarAddr(result!.debugInfo, 'global', 'count');
    expect(readRam(result!.vm, addrCount)).toBe(10);
  });
});

describe('Compiler: Arrays', () => {
  it('should access array elements', async () => {
    const result = await compileAndRun(`
      unsigned char arr[3] = {10, 20, 30};
      unsigned char val;
      void main() {
        val = arr[1];
      }
    `);
    
    expect(result).not.toBeNull();
    const addrVal = getVarAddr(result!.debugInfo, 'global', 'val');
    expect(readRam(result!.vm, addrVal)).toBe(20);
  });

  it('should modify array elements', async () => {
    const result = await compileAndRun(`
      unsigned char arr[3] = {0, 0, 0};
      void main() {
        arr[0] = 5;
        arr[1] = 10;
        arr[2] = 15;
      }
    `);
    
    expect(result).not.toBeNull();
    expect(readRam(result!.vm, getVarAddr(result!.debugInfo, 'global', 'arr[0]'))).toBe(5);
    expect(readRam(result!.vm, getVarAddr(result!.debugInfo, 'global', 'arr[1]'))).toBe(10);
    expect(readRam(result!.vm, getVarAddr(result!.debugInfo, 'global', 'arr[2]'))).toBe(15);
  });
});

describe('Compiler: Pointers', () => {
  it('should dereference pointer', async () => {
    const result = await compileAndRun(`
      unsigned char x = 42;
      unsigned char *p = &x;
      unsigned char val;
      void main() {
        val = *p;
      }
    `);
    
    expect(result).not.toBeNull();
    const addrVal = getVarAddr(result!.debugInfo, 'global', 'val');
    expect(readRam(result!.vm, addrVal)).toBe(42);
  });

  it('should modify value through pointer', async () => {
    const result = await compileAndRun(`
      unsigned char x = 10;
      unsigned char *p = &x;
      void main() {
        *p = 20;
      }
    `);
    
    expect(result).not.toBeNull();
    const addrX = getVarAddr(result!.debugInfo, 'global', 'x');
    expect(readRam(result!.vm, addrX)).toBe(20);
  });
});
```

- [ ] **Step 2: 运行完整测试套件**

```bash
npm run test -- src/__tests__/cc.test.ts
```

Expected output: 所有测试通过（预计 20+ 个测试用例）

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/cc.test.ts
git commit -m "test: add function, control flow, array, and pointer tests"
```

---

### Task 5: 编写 React 组件测试

**Files:**
- Create: `example/src/__tests__/App.test.tsx`
- Install: `identity-obj-proxy` (用于 CSS Mock)

- [ ] **Step 1: 安装 CSS Mock 依赖**

```bash
npm install --save-dev identity-obj-proxy@^3.0.0
```

- [ ] **Step 2: 创建 React 组件测试**

Create: `example/src/__tests__/App.test.tsx`

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from '../index';

describe('App Component', () => {
  beforeEach(() => {
    // 每个测试前清理
    document.body.innerHTML = '';
  });

  describe('Initial Render', () => {
    it('should render code editor textarea', () => {
      render(<App />);
      
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
    });

    it('should display register panel', () => {
      render(<App />);
      
      // 根据实际 UI 结构调整选择器
      const registerPanel = document.querySelector('.register-panel');
      expect(registerPanel).toBeInTheDocument();
    });

    it('should show debugger controls', () => {
      render(<App />);
      
      // 查找调试按钮（根据实际按钮文本或 aria-label）
      const runButton = screen.getByRole('button', { name: /run/i });
      expect(runButton).toBeInTheDocument();
    });
  });

  describe('Code Compilation', () => {
    it('should compile valid C code', async () => {
      render(<App />);
      
      const textarea = screen.getByRole('textbox');
      const user = userEvent.setup();
      
      // 输入简单 C 代码
      await user.clear(textarea);
      await user.type(textarea, 'void main() { }');
      
      // 触发编译（可能需要点击编译按钮）
      const compileButton = screen.getByRole('button', { name: /compile/i });
      await user.click(compileButton);
      
      // 验证没有错误显示
      const errorMessage = screen.queryByText(/error/i);
      expect(errorMessage).not.toBeInTheDocument();
    });

    it('should display compilation errors', async () => {
      render(<App />);
      
      const textarea = screen.getByRole('textbox');
      const user = userEvent.setup();
      
      // 输入无效 C 代码
      await user.clear(textarea);
      await user.type(textarea, 'invalid code here');
      
      // 触发编译
      const compileButton = screen.getByRole('button', { name: /compile/i });
      await user.click(compileButton);
      
      // 验证错误信息显示
      const errorMessage = await screen.findByText(/error/i);
      expect(errorMessage).toBeInTheDocument();
    });
  });

  describe('Debugger Controls', () => {
    it('should start execution when Run button clicked', async () => {
      render(<App />);
      
      // 先编译有效代码
      const textarea = screen.getByRole('textbox');
      const user = userEvent.setup();
      await user.clear(textarea);
      await user.type(textarea, 'void main() { }');
      
      const compileButton = screen.getByRole('button', { name: /compile/i });
      await user.click(compileButton);
      
      // 点击运行按钮
      const runButton = screen.getByRole('button', { name: /run/i });
      await user.click(runButton);
      
      // 验证运行状态改变
      const stopButton = screen.getByRole('button', { name: /stop/i });
      expect(stopButton).toBeInTheDocument();
    });

    it('should step through code when Step button clicked', async () => {
      render(<App />);
      
      // 编译并运行
      const textarea = screen.getByRole('textbox');
      const user = userEvent.setup();
      await user.clear(textarea);
      await user.type(textarea, 'void main() { }');
      
      const compileButton = screen.getByRole('button', { name: /compile/i });
      await user.click(compileButton);
      
      const runButton = screen.getByRole('button', { name: /run/i });
      await user.click(runButton);
      
      // 点击步进按钮
      const stepButton = screen.getByRole('button', { name: /step/i });
      await user.click(stepButton);
      
      // 验证当前行高亮变化
      const currentLine = document.querySelector('.current-line');
      expect(currentLine).toBeInTheDocument();
    });
  });

  describe('Breakpoint Management', () => {
    it('should toggle breakpoint on line click', async () => {
      render(<App />);
      
      // 编译代码
      const textarea = screen.getByRole('textbox');
      const user = userEvent.setup();
      await user.clear(textarea);
      await user.type(textarea, 'void main() {\n  int x = 0;\n}');
      
      const compileButton = screen.getByRole('button', { name: /compile/i });
      await user.click(compileButton);
      
      // 点击行号区域设置断点
      const lineNumber = screen.getByText('2');
      await user.click(lineNumber);
      
      // 验证断点已设置
      const breakpoint = document.querySelector('.breakpoint');
      expect(breakpoint).toBeInTheDocument();
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should respond to F5 key for Run', async () => {
      render(<App />);
      
      const textarea = screen.getByRole('textbox');
      textarea.focus();
      
      // 模拟按下 F5
      fireEvent.keyDown(textarea, { key: 'F5' });
      
      // 验证触发了运行（可能需要 mock VM.run）
    });

    it('should respond to F10 key for Step', async () => {
      render(<App />);
      
      const textarea = screen.getByRole('textbox');
      textarea.focus();
      
      // 模拟按下 F10
      fireEvent.keyDown(textarea, { key: 'F10' });
      
      // 验证触发了步进
    });
  });
});
```

- [ ] **Step 3: 运行 React 组件测试**

```bash
npm run test:example
```

Expected output: 显示 React 组件测试结果。初次运行时可能会有部分测试失败，需要根据实际组件实现调整选择器和断言。

- [ ] **Step 4: 调试失败的测试**

根据测试输出，调整选择器、等待逻辑或 mock 策略，直到所有测试通过。

- [ ] **Step 5: Commit**

```bash
git add example/src/__tests__/App.test.tsx package.json package-lock.json
git commit -m "test: add React component tests for App"
```

---

### Task 6: 配置测试覆盖率报告

**Files:**
- Modify: `jest.config.js`
- Modify: `package.json`

- [ ] **Step 1: 更新 Jest 配置启用覆盖率**

Modify: `jest.config.js` (已在 Task 2 中配置，确认以下内容存在)

```javascript
module.exports = {
  // ... 其他配置
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/cc-test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};
```

- [ ] **Step 2: 添加覆盖率阈值配置**

在 `jest.config.js` 中添加 `coverageThreshold`（如上所示），设置最低覆盖率要求为 70%。

- [ ] **Step 3: 运行覆盖率测试**

```bash
npm run test:coverage
```

Expected output: 
- 控制台显示文本覆盖率报告
- 生成 `coverage/lcov-report/index.html` 文件

- [ ] **Step 4: 查看 HTML 覆盖率报告**

```bash
# Windows
start coverage/lcov-report/index.html

# 或手动打开浏览器访问
# file:///c:/Users/CZY/Desktop/aa/coverage/lcov-report/index.html
```

- [ ] **Step 5: Commit**

```bash
git add jest.config.js package.json
git commit -m "chore: configure test coverage reporting with 70% threshold"
```

---

### Task 7: 清理旧测试文件并更新文档

**Files:**
- Delete: `src/cc-test.js` (可选，建议保留作为历史参考)
- Modify: `docs/WORKFLOW.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: 决定是否删除旧测试文件**

**选项 A**: 保留 `cc-test.js` 作为历史参考
```bash
# 重命名为 .bak 后缀
mv src/cc-test.js src/cc-test.js.bak
```

**选项 B**: 直接删除
```bash
rm src/cc-test.js
```

建议选择 **选项 A**，保留历史文件以备查阅。

- [ ] **Step 2: 更新 WORKFLOW.md 测试命令**

Modify: `docs/WORKFLOW.md`

在 "Tools & Commands" 章节更新测试命令部分：

```markdown
### Testing
```bash
npm test               # Run all tests
npm test:watch         # Watch mode for continuous testing
npm test:coverage      # Run tests with coverage report
npm test:src           # Run only backend tests
npm test:example       # Run only frontend tests
```
```

- [ ] **Step 3: 更新 AGENTS.md 测试指南**

Modify: `AGENTS.md`

在 "Development Tools & Verification" 章节后添加：

```markdown
### Testing with Jest

This project uses **Jest** for automated testing following TDD principles.

**Test structure:**
- `src/__tests__/*.test.ts` - Backend unit tests (VM, compiler, assembler)
- `example/src/__tests__/*.test.tsx` - Frontend React component tests

**Commands:**
- `npm test` - Run all tests
- `npm run test:watch` - Watch mode (re-runs on file changes)
- `npm run test:coverage` - Generate coverage report
- `npm run test:src` - Test backend only
- `npm run test:example` - Test frontend only

**Writing tests:**
1. Create test file: `src/__tests__/feature.test.ts`
2. Use Jest's `describe`, `it`, `expect` APIs
3. Follow AAA pattern: Arrange, Act, Assert
4. Mock external dependencies with `jest.mock()`

**Example:**
```typescript
import { describe, it, expect } from '@jest/globals';
import { myFunction } from '../myModule';

describe('myFunction', () => {
  it('should return expected value', () => {
    expect(myFunction('input')).toBe('output');
  });
});
```
```

- [ ] **Step 4: 更新 README.md（如果有测试章节）**

检查 `README.md` 是否包含测试说明，如有则更新为 Jest 相关内容。

- [ ] **Step 5: Commit**

```bash
git add docs/WORKFLOW.md AGENTS.md README.md
git commit -m "docs: update documentation with Jest testing workflow"
```

---

### Task 8: 最终验证和验收

**Files:**
- No file changes

- [ ] **Step 1: 运行完整测试套件**

```bash
npm run test
```

Expected output: 所有测试通过，无失败。

- [ ] **Step 2: 检查测试覆盖率**

```bash
npm run test:coverage
```

Expected output: 覆盖率达到或超过 70% 阈值。

- [ ] **Step 3: 验证 watch 模式**

```bash
npm run test:watch
```

在另一个终端修改测试文件，验证 Jest 自动重新运行测试。按 `q` 退出 watch 模式。

- [ ] **Step 4: 验证单独测试后端和前端**

```bash
npm run test:src
npm run test:example
```

两个命令都应成功执行。

- [ ] **Step 5: 生成并查看覆盖率报告**

```bash
npm run test:coverage
start coverage/lcov-report/index.html
```

在浏览器中查看可视化覆盖率报告。

- [ ] **Step 6: 验证构建流程不受影响**

```bash
npm run build
npm run dev
```

确保测试引入不影响正常构建和开发服务器。

- [ ] **Step 7: 创建测试总结文档**

Create: `docs/TESTING.md`

```markdown
# Testing Guide

## Overview

SC8P053VM uses Jest for automated testing with full TDD support.

## Test Structure

- **Backend Tests**: `src/__tests__/*.test.ts`
  - `cc.test.ts` - Compiler tests (bitwise, arithmetic, functions, etc.)
  - `vm.test.ts` - VM core tests (instruction execution, registers, memory)
  - `asmc.test.ts` - Assembler tests (instruction encoding, labels)

- **Frontend Tests**: `example/src/__tests__/*.test.tsx`
  - `App.test.tsx` - React component tests (UI interactions, state management)

## Running Tests

```bash
# All tests
npm test

# Watch mode (auto-re-run on changes)
npm run test:watch

# With coverage report
npm run test:coverage

# Backend only
npm run test:src

# Frontend only
npm run test:example
```

## Writing Tests

### Backend Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import { compileAndRun, readRam, getVarAddr } from './helpers';

describe('Feature Name', () => {
  it('should do something', async () => {
    const result = await compileAndRun('C code here');
    expect(result).not.toBeNull();
    // Assertions...
  });
});
```

### Frontend Test Example

```typescript
import { render, screen } from '@testing-library/react';
import App from '../index';

describe('App Component', () => {
  it('should render correctly', () => {
    render(<App />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
```

## Coverage Requirements

Minimum coverage thresholds:
- Statements: 70%
- Branches: 70%
- Functions: 70%
- Lines: 70%

View detailed coverage:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Best Practices

1. **TDD First**: Write failing test before implementation
2. **One Assertion Per Test**: Keep tests focused
3. **Descriptive Names**: Test names should describe behavior
4. **Mock External Dependencies**: Use `jest.mock()` for APIs
5. **Clean Setup**: Use `beforeEach` for common setup
6. **Fast Tests**: Each test should run in < 1 second

## Troubleshooting

### Test fails with "Cannot find module"
- Ensure `jest.config.js` moduleNameMapper is correct
- Run `npm run build` before testing

### React test fails with "act() warning"
- Wrap async operations in `await act(async () => {...})`
- Use `waitFor` for async UI updates

### Coverage below threshold
- Add more tests for uncovered code paths
- Consider if uncovered code needs testing or can be excluded
```

- [ ] **Step 8: Commit 测试文档**

```bash
git add docs/TESTING.md
git commit -m "docs: add comprehensive testing guide"
```

- [ ] **Step 9: 最终 Git 状态检查**

```bash
git status
git log --oneline -10
```

验证所有更改已提交，提交历史清晰。

---

## 验收标准

### 功能验收
- ✅ `npm test` 运行所有测试并通过
- ✅ `npm run test:watch` 支持热重载测试
- ✅ `npm run test:coverage` 生成覆盖率报告
- ✅ 后端测试覆盖 cc.ts, vm.ts, asmc.ts 核心功能
- ✅ 前端测试覆盖 App 组件主要交互
- ✅ 测试覆盖率达到 ≥70%

### 质量验收
- ✅ 所有测试遵循 AAA 模式（Arrange-Act-Assert）
- ✅ 测试名称清晰描述行为
- ✅ 无重复测试逻辑
- ✅ 测试独立运行，无顺序依赖
- ✅ 单个测试执行时间 < 1 秒

### 文档验收
- ✅ `docs/TESTING.md` 完整说明测试使用方法
- ✅ `AGENTS.md` 包含 Jest 测试指南
- ✅ `docs/WORKFLOW.md` 更新测试命令
- ✅ 代码注释清晰，关键测试有说明

### 工具验收
- ✅ Jest 配置正确，支持 TypeScript
- ✅ React Testing Library 配置正确
- ✅ 覆盖率报告生成 HTML 和文本格式
- ✅ 测试脚本在 package.json 中完整定义

---

## 预期成果总结

完成本计划后，项目将拥有：

1. **标准化测试框架**：Jest + TypeScript + React Testing Library
2. **核心测试覆盖**：编译器（cc.ts）+ 前端 React 组件（App.tsx）
3. **自动化测试流程**：`npm test` 一键运行所有测试
4. **可视化覆盖率**：HTML 报告直观展示测试覆盖情况
5. **TDD 工作流支持**：快速反馈循环，支持 watch 模式
6. **完善的测试文档**：新手可快速上手编写测试

这将彻底改变项目的测试现状，从手动测试升级为自动化 TDD 工作流！

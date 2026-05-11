# Testing Guide

## Overview

SC8P053VM uses Jest for automated testing with full TDD support.

## Test Structure

- **Backend Tests**: `src/__tests__/*.test.ts`
  - `cc.test.ts` - Compiler tests (bitwise, arithmetic, control flow, etc.)

- **Frontend Tests**: `example/src/__tests__/*.test.tsx`
  - `App.test.tsx` - React component tests (component structure, methods)

## Running Tests

```bash
# Backend tests only
npm test

# Frontend tests only
npm run test:example
```

## Writing Tests

### Backend Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import { compile, DebugInfo } from '../cc';
import { VM } from '../vm';

// Helper function
async function compileAndRun(
  source: string,
  maxCycles = 200000
): Promise<{ vm: VM; debugInfo: DebugInfo } | null> {
  const { debugInfo, rom } = await compile(source);
  if (!rom) return null;
  
  const vm = new VM(rom, { wdt: false, lvrSel: 0x03, fcpuDiv: 4 });
  vm.run(maxCycles);
  
  return { vm, debugInfo };
}

describe('Compiler: Bitwise Operations', () => {
  it('should shift left by 1: 0x03 << 1 = 0x06', async () => {
    const result = await compileAndRun(`
      void main() {
        unsigned char a = 0x03;
        a = a << 1;
      }
    `);
    
    expect(result).not.toBeNull();
    const addr = result!.debugInfo.varMap.get('main')!.get('a');
    const value = result!.vm.getState().ram[addr];
    expect(value).toBe(0x06);
  });
});
```

### Frontend Test Example

```typescript
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';

// Mock ReactDOM to prevent auto-rendering
jest.mock('react-dom/client', () => ({
  createRoot: jest.fn(() => ({
    render: jest.fn(),
    unmount: jest.fn()
  }))
}));

import App from '../index';

describe('App Component', () => {
  it('should successfully import App component', () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
  });

  it('should have constructor that initializes state', () => {
    const app = new App({});
    expect(app.state).toBeDefined();
    expect(app.state.code).toBeDefined();
  });
});
```

## Coverage Thresholds

**Note**: This project does not enforce coverage thresholds. Focus on writing meaningful tests that verify core functionality rather than chasing coverage percentages.

Current test coverage is approximately 29% because only core compiler tests have been migrated from `src/cc-test.js`. To improve coverage, migrate more test cases as needed.

## Legacy Tests

The file `src/cc-test.js` contains the original custom test framework (3418 lines, 2800+ test cases). It is kept for historical reference but is excluded from Jest test runs.

To run legacy tests:
```bash
node src/cc-test.js
```

## Best Practices

1. **Write tests first** - Follow TDD: RED → GREEN → REFACTOR
2. **Test one thing per test** - Each test should verify a single behavior
3. **Use descriptive names** - Test names should explain what is being tested
4. **Keep tests independent** - Tests should not depend on each other
5. **Mock external dependencies** - Use Jest mocks for APIs, DOM, etc.
6. **Update tests when refactoring** - Keep tests synchronized with code changes

## Troubleshooting

### TypeScript type errors in tests

If you see errors like `Property 'toBeInTheDocument' does not exist`, add this to the top of your test file:

```typescript
/// <reference types="@testing-library/jest-dom" />
```

Or configure types in `jest.config.js`:

```javascript
transform: {
  '^.+\\.tsx?$': [
    'ts-jest',
    {
      tsconfig: {
        types: ['jest', '@testing-library/jest-dom']
      }
    }
  ]
}
```

### Module resolution errors

For frontend tests, ensure `example/jest.config.js` has correct module mapping:

```javascript
moduleNameMapper: {
  '^sc8p053vm$': '<rootDir>/../dist/index.js',
  '\\.(css|less|scss)$': 'identity-obj-proxy'
}
```

### DOM element not found

If testing React components that auto-render (like `index.tsx`), mock ReactDOM:

```typescript
jest.mock('react-dom/client', () => ({
  createRoot: jest.fn(() => ({
    render: jest.fn(),
    unmount: jest.fn()
  }))
}));
```

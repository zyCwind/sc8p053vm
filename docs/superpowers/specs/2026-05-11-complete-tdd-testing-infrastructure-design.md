# 完整 TDD 测试基础设施设计规格

## 问题陈述

当前 SC8P053VM 项目的测试机制非常原始：

1. **编译器测试**：只有一个 `src/cc-test.js` 文件（3418行），使用自定义的简单测试框架，需要手动运行 `node cc-test.js`，无法与标准工具链集成。

2. **前端测试缺失**：example/ 目录的 React 组件完全没有自动化测试，只能手动在浏览器中测试。

3. **核心模块无测试**：`src/vm.ts` 和 `src/asmc.ts` 没有任何测试文件，完全依赖手动验证。

4. **缺乏标准化**：没有使用行业标准测试框架，无法实现测试覆盖率监控、持续集成等现代开发实践。

这导致：
- 修改代码时无法快速验证是否引入回归错误
- 新开发者难以理解各模块的预期行为
- 重构代码时缺乏安全保障
- 无法量化代码质量（无覆盖率指标）

## 目标

建立完整的自动化测试体系，实现真正的 TDD（测试驱动开发）工作流：

1. **标准化测试框架**：采用行业标准的 Jest + React Testing Library
2. **全栈测试覆盖**：后端（cc.ts, vm.ts, asmc.ts）+ 前端（React 组件）
3. **自动化测试流程**：一键运行所有测试，支持 watch 模式
4. **可视化覆盖率**：生成 HTML 覆盖率报告，设置最低阈值
5. **完善的文档**：提供清晰的测试编写指南和使用说明

## 技术方案

### 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 测试框架 | Jest v29.x | 成熟稳定，社区广泛，TypeScript 支持完善 |
| TypeScript 支持 | ts-jest | Jest 官方推荐的 TS 预处理器 |
| React 测试 | @testing-library/react v14.x | React 官方推荐，注重用户行为而非实现细节 |
| DOM 断言 | @testing-library/jest-dom | 提供丰富的 DOM 相关断言方法 |
| 用户交互模拟 | @testing-library/user-event | 更真实的用户事件模拟 |
| 浏览器环境 | jest-environment-jsdom | 在 Node.js 中模拟浏览器环境 |
| CSS Mock | identity-obj-proxy | 将 CSS 导入转换为空对象 |

**为什么不选 Vitest？**
- 项目已有一定规模，Jest 生态更成熟
- 团队可能更熟悉 Jest API
- 文档和社区资源更丰富
- 虽然 Vitest 更快，但本项目测试规模不大，性能差异不明显

### 架构设计

```
项目根目录
├── jest.config.js              # 后端测试配置（Node 环境）
├── package.json                # 添加 test 脚本
├── src/
│   └── __tests__/
│       └── cc.test.ts          # 编译器测试（含辅助函数）
└── example/
    ├── jest.config.js          # 前端测试配置（jsdom 环境）
    └── src/
        └── __tests__/
            └── App.test.tsx    # React 组件测试
```

### 测试分层策略

#### 1. 编译器测试（cc.test.ts）
**目标**：测试 C 编译器到 SC8P053 机器码的转换正确性

**覆盖范围**：
- 位运算：左移、右移、按位与/或/异或
- 算术运算：加减乘除、自增自减
- 控制流：if-else、for、while、switch
- 函数：定义、调用、递归、参数传递
- 数组：声明、访问、修改
- 指针：取地址、解引用、指针运算

**特点**：
- 在测试文件内定义辅助函数（compileAndRun, readRam, getVarAddr）
- 编译 → VM 执行完整流程验证
- 快速执行（< 100ms/测试）

#### 2. React 组件测试（App.test.tsx）
**目标**：测试 React 组件的用户交互

**覆盖范围**：
- App 组件的渲染
- 用户输入（代码编辑）
- 按钮点击（编译、运行、步进）
- 键盘快捷键
- 状态变化（断点、当前行高亮）

**特点**：
- 使用 jsdom 模拟浏览器环境
- 关注用户可见行为，不测试内部实现
- 适当 mock 外部依赖（如 VM 执行）

## API 设计

### 编译器测试辅助函数（在 cc.test.ts 内定义）

```typescript
// 在 cc.test.ts 文件顶部定义
interface CompileAndRunResult {
  vm: VM;
  debugInfo: DebugInfo;
}

async function compileAndRun(
  source: string,
  maxCycles?: number
): Promise<CompileAndRunResult | null> {
  const { debugInfo, rom } = await compile(source);
  if (!rom) return null;
  
  const vm = new VM(rom, { wdt: false });
  vm.run(maxCycles || 200000);
  
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
```

**设计理由**：
- 辅助函数直接嵌入测试文件，避免额外文件依赖
- 简化项目结构，降低维护成本
- 所有测试相关代码集中在一个文件中

### Jest 配置

#### 后端配置（jest.config.js）

```javascript
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

#### 前端配置（example/jest.config.js）

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.tsx'],
  setupFilesAfterSetup: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^sc8p053vm$': '<rootDir>/../dist/index.js',
    '\\.(css|less|scss)$': 'identity-obj-proxy'
  }
};
```

### npm 脚本

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

## 数据流

### 后端测试流程

```
测试用例
  ↓
compileAndRun(source)
  ↓
compile(source) → { debugInfo, rom }
  ↓
new VM(rom).run(maxCycles)
  ↓
readRam(vm, addr) / getState()
  ↓
expect().toBe() 断言
```

### 前端测试流程

```
测试用例
  ↓
render(<App />)
  ↓
userEvent.type/click() 模拟用户操作
  ↓
screen.getByRole/queryByText() 查询 DOM
  ↓
expect().toBeInTheDocument() 断言
```

## 错误处理

### 测试失败场景

1. **编译失败**：`compileAndRun` 返回 `null`
   - 测试应明确检查 `expect(result).not.toBeNull()`
   - 提供清晰的错误信息

2. **变量未找到**：`getVarAddr` 抛出错误
   - 捕获错误并提供上下文信息
   - 帮助定位是测试代码问题还是编译器问题

3. **异步超时**：VM 执行超过 maxCycles
   - 默认 200000 cycles，复杂测试可增加
   - Jest 默认 5000ms 超时，可通过 `jest.setTimeout()` 调整

4. **DOM 元素未找到**：React 测试中查询失败
   - 使用 `waitFor` 等待异步更新
   - 使用 `findBy*` 方法自动等待

### Mock 策略

**需要 Mock 的内容**：
- 文件系统操作（如果有）
- 网络请求（如果有）
- 长时间运行的计算（可选，用于加速测试）

**不需要 Mock 的内容**：
- VM 核心逻辑（应真实执行以验证正确性）
- 编译器逻辑（应真实编译以验证代码生成）

## 测试策略

### 编译器测试（cc.test.ts）

**测试分类**：
1. **位运算**：左移、右移、按位与/或/异或
2. **算术运算**：加减乘除、自增自减
3. **控制流**：if-else、for、while、switch
4. **函数**：定义、调用、递归、参数传递
5. **数组**：声明、访问、修改
6. **指针**：取地址、解引用、指针运算
7. **预处理**：宏定义、条件编译
8. **错误检测**：语法错误、类型错误

**测试数据来源**：
- 从现有 `cc-test.js` 迁移核心测试用例（约 500-1000 个）
- 优先覆盖常用功能和边界情况

### React 组件测试（App.test.tsx）

**测试分类**：
1. **初始渲染**：所有 UI 元素正确显示
2. **代码编译**：输入 C 代码，触发布局变化
3. **调试控制**：运行、暂停、步进、重置
4. **断点管理**：设置、清除、命中断点
5. **键盘快捷键**：F5-F10 功能键
6. **状态同步**：寄存器、内存、端口的实时更新

**测试原则**：
- 测试用户可见行为，不测试实现细节
- 使用语义化查询（getByRole > getByText > getByTestId）
- 避免测试 CSS 样式（属于视觉回归测试范畴）

## 覆盖率目标

### 最低阈值

| 指标 | 目标 | 理由 |
|------|------|------|
| Statements | 70% | 保证大部分代码被执行 |
| Branches | 70% | 保证条件分支被充分测试 |
| Functions | 70% | 保证大部分函数被调用 |
| Lines | 70% | 保证大部分代码行被覆盖 |

**为什么是 70% 而不是更高？**
- 初期目标应可实现，避免过度追求覆盖率
- 某些代码难以测试（错误处理、边界情况）
- 100% 覆盖率不等于 100% 正确性
- 可随项目成熟度逐步提高阈值

### 排除项

以下代码可从覆盖率统计中排除：
- 测试文件本身（`__tests__/`）
- 类型定义文件（`.d.ts`）
- 旧测试文件（`cc-test.js`，迁移后可删除）
- 纯类型导出（仅包含 interface/type 的文件）

## 迁移策略

### cc-test.js 迁移计划

**现状**：
- 3418 行自定义测试代码
- 使用 `test()` 和 `assert()` 函数
- 手动运行，无标准化输出

**迁移步骤**：
1. 分析现有测试结构，识别测试分类
2. 创建 Jest 格式的测试文件骨架
3. 分批迁移测试用例（按功能模块）
4. 验证迁移后的测试全部通过
5. 保留原文件作为历史参考（重命名为 `.bak`）

**迁移优先级**：
1. 基础运算（位运算、算术运算）- 最高优先级
2. 控制流（if、for、while）- 高优先级
3. 函数和指针 - 中优先级
4. 高级特性（宏、内联汇编）- 低优先级

### 渐进式实施

**阶段 1**：基础设施搭建（1-2天）
- 安装依赖
- 配置 Jest
- 创建辅助函数
- 运行第一个测试

**阶段 2**：编译器测试迁移（2-3天）
- 迁移 cc-test.js 核心测试用例
- 达到 70% 覆盖率

**阶段 3**：前端测试编写（2-3天）
- 编写 App.test.tsx
- Mock VM 执行（可选，加速测试）
- 验证用户交互

**阶段 4**：文档和优化（1天）
- 编写 TESTING.md
- 更新 AGENTS.md 和 WORKFLOW.md
- 优化测试性能
- 最终验收

## 风险评估

### 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Jest 与现有构建冲突 | 低 | 中 | 使用独立的 jest.config.js |
| React 测试环境配置复杂 | 中 | 中 | 参考官方文档，逐步调试 |
| 测试执行速度慢 | 中 | 低 | 并行执行，mock 耗时操作 |
| 覆盖率难以达标 | 低 | 低 | 调整阈值，排除不可测代码 |

### 时间风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 迁移 cc-test.js 耗时超预期 | 中 | 中 | 分批迁移，优先核心功能 |
| React 组件测试难度大 | 中 | 中 | 先测试简单交互，逐步深入 |
| 调试配置问题耗时 | 低 | 低 | 参考官方示例，查阅文档 |

### 质量风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 测试覆盖不全 | 中 | 高 | 代码审查，覆盖率报告检查 |
| 测试脆弱易碎 | 中 | 中 | 遵循最佳实践，避免测试实现细节 |
| 测试维护成本高 | 低 | 中 | 保持测试简洁，提取公共逻辑 |

## 成功标准

### 功能标准
- ✅ `npm test` 运行所有测试并通过
- ✅ `npm run test:watch` 支持热重载
- ✅ `npm run test:coverage` 生成覆盖率报告
- ✅ 编译器测试覆盖 cc.ts 核心功能
- ✅ 前端测试覆盖 App 组件主要交互
- ✅ 测试覆盖率 ≥ 70%

### 质量标准
- ✅ 所有测试遵循 AAA 模式（Arrange-Act-Assert）
- ✅ 测试名称清晰描述行为
- ✅ 无重复测试逻辑
- ✅ 测试独立运行，无顺序依赖
- ✅ 单个测试执行时间 < 1 秒

### 文档标准
- ✅ `docs/TESTING.md` 完整说明测试使用方法
- ✅ `AGENTS.md` 包含 Jest 测试指南
- ✅ `docs/WORKFLOW.md` 更新测试命令
- ✅ 代码注释清晰，关键测试有说明

## 替代方案考虑

### 方案 A：Vitest（已否决）
**优点**：
- 更快的执行速度
- 原生 ESM 支持
- 更现代的 API

**缺点**：
- 生态系统不如 Jest 成熟
- 团队熟悉度较低
- 文档资源相对较少

**否决原因**：项目规模不大，Jest 的性能足够；Jest 生态更成熟，长期维护更有保障。

### 方案 B：仅后端测试（已否决）
**优点**：
- 实施速度快
- 复杂度低

**缺点**：
- 前端代码无测试保障
- UI 回归错误无法自动检测
- 不符合"完整测试体系"的目标

**否决原因**：用户明确要求"完整测试体系（一步到位）"，必须包含前端测试。

### 方案 C：保留 cc-test.js，不迁移（已否决）
**优点**：
- 无需迁移工作
- 保持现有测试可用

**缺点**：
- 无法享受 Jest 的优势（watch 模式、覆盖率、并行执行）
- 两套测试系统并存，增加维护成本
- 不符合标准化目标

**否决原因**：迁移工作量可控，且能带来显著的长期收益。

## 结论

本设计方案提出了一套完整的 TDD 测试基础设施，采用成熟的 Jest + React Testing Library 技术栈，覆盖后端和前端全栈测试。通过渐进式实施策略，可在 1 周内完成从基础设施搭建到最终验收的全过程。

关键成功因素：
1. **标准化**：采用行业标准工具，降低学习成本
2. **完整性**：覆盖所有核心模块，不留测试盲区
3. **可用性**：提供清晰的文档和辅助函数，降低测试编写门槛
4. **可持续性**：设置合理的覆盖率阈值，确保长期可维护

此方案将为项目带来：
- 更快的反馈循环（TDD 工作流）
- 更高的代码质量（覆盖率监控）
- 更强的重构信心（自动化回归测试）
- 更好的团队协作（标准化测试规范）

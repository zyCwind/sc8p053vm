# ADR 003: 采用 Jest 建立完整 TDD 测试基础设施

**Date**: 2026-05-11  
**Status**: Accepted  
**Deciders**: Project team  
**Technical Story**: Establishing complete TDD testing infrastructure with Jest

---

## Context

SC8P053VM 项目当前的测试机制存在以下问题：

1. **编译器测试原始**：只有一个 `src/cc-test.js` 文件（3418行），使用自定义的简单测试框架，需要手动运行 `node cc-test.js`，无法与标准工具链集成。

2. **前端测试缺失**：example/ 目录的 React 组件完全没有自动化测试，只能手动在浏览器中测试。

3. **核心模块无测试**：`src/vm.ts` 和 `src/asmc.ts` 没有任何测试文件，完全依赖手动验证。

4. **缺乏标准化**：没有使用行业标准测试框架，无法实现测试覆盖率监控、持续集成等现代开发实践。

这导致：
- 修改代码时无法快速验证是否引入回归错误
- 新开发者难以理解各模块的预期行为
- 重构代码时缺乏安全保障
- 无法量化代码质量（无覆盖率指标）

项目已确立 TDD（测试驱动开发）为强制性开发原则（见 AGENTS.md），但缺乏相应的基础设施支持。

---

## Decision

我们决定采用 **Jest + React Testing Library** 技术栈建立完整的自动化测试体系，实现真正的 TDD 工作流。

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

### 为什么不选 Vitest？

虽然 Vitest 执行速度更快且原生支持 ESM，但我们选择 Jest 的原因：
- 项目规模不大，性能差异不明显
- Jest 生态系统更成熟，文档和社区资源更丰富
- 团队可能更熟悉 Jest API
- 长期维护更有保障

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

### 覆盖率目标

设置最低阈值为 **70%**（Statements, Branches, Functions, Lines）：

**为什么是 70% 而不是更高？**
- 初期目标应可实现，避免过度追求覆盖率
- 某些代码难以测试（错误处理、边界情况）
- 100% 覆盖率不等于 100% 正确性
- 可随项目成熟度逐步提高阈值

### 迁移策略

**cc-test.js 迁移计划**：
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

---

## Consequences

### Positive

1. **更快的反馈循环**
   - TDD 工作流：先写测试再写代码
   - 即时验证代码正确性
   - 减少调试时间

2. **更高的代码质量**
   - 自动化回归测试防止引入 bug
   - 覆盖率监控确保测试充分性
   - 强制编写可测试的代码

3. **更强的重构信心**
   - 测试套件作为安全网
   - 大胆重构而不担心破坏功能
   - 持续改进代码结构

4. **更好的团队协作**
   - 标准化测试规范降低沟通成本
   - 测试即文档，清晰展示预期行为
   - 新人可通过测试快速理解模块

5. **现代化开发实践**
   - 行业标准工具链
   - 支持 CI/CD 集成
   - 便于未来扩展

### Negative

1. **初始实施成本**
   - 安装和配置依赖
   - 迁移现有测试用例
   - 学习 Jest API 和最佳实践

2. **维护负担**
   - 测试代码也需要维护
   - 随功能更新同步更新测试
   - 配置文件需要管理

3. **执行时间增加**
   - 测试运行增加开发周期时间
   - 但可通过 watch 模式和并行执行缓解

4. **可能的测试脆弱性**
   - 如果测试实现细节而非行为，容易破碎
   - 需要遵循最佳实践避免此问题

### Mitigation Strategies

- 渐进式实施：分阶段完成，降低风险
- 提供清晰的文档和辅助函数，降低测试编写门槛
- 遵循 AAA 模式（Arrange-Act-Assert）保持测试简洁
- 定期审查测试质量，移除冗余测试
- 设置合理的覆盖率阈值，避免过度追求数字

---

## Alternatives Considered

### Alternative 1: Vitest

**优点**：
- 更快的执行速度
- 原生 ESM 支持
- 更现代的 API

**缺点**：
- 生态系统不如 Jest 成熟
- 团队熟悉度较低
- 文档资源相对较少

**否决原因**：项目规模不大，Jest 的性能足够；Jest 生态更成熟，长期维护更有保障。

### Alternative 2: 仅后端测试

**优点**：
- 实施速度快
- 复杂度低

**缺点**：
- 前端代码无测试保障
- UI 回归错误无法自动检测
- 不符合"完整测试体系"的目标

**否决原因**：用户明确要求"完整测试体系（一步到位）"，必须包含前端测试。

### Alternative 3: 保留 cc-test.js，不迁移

**优点**：
- 无需迁移工作
- 保持现有测试可用

**缺点**：
- 无法享受 Jest 的优势（watch 模式、覆盖率、并行执行）
- 两套测试系统并存，增加维护成本
- 不符合标准化目标

**否决原因**：迁移工作量可控，且能带来显著的长期收益。

### Alternative 4: 不使用自动化测试

**优点**：
- 零配置成本
- 开发速度快（短期）

**缺点**：
- 无法保证代码质量
- 重构风险极高
- 不符合项目 TDD 原则

**否决原因**：AGENTS.md 明确规定 TDD 是强制性开发原则，不可违背。

---

## Implementation Notes

### Phase 1: 基础设施搭建（1-2天）
- ✅ 安装依赖（Jest, ts-jest, @testing-library/*）
- ✅ 配置 jest.config.js（后端）
- ✅ 配置 example/jest.config.js（前端）
- ✅ 创建辅助函数（compileAndRun, readRam, getVarAddr）
- ✅ 运行第一个测试验证配置

### Phase 2: 编译器测试迁移（2-3天）
- 迁移 cc-test.js 核心测试用例
- 达到 70% 覆盖率
- 验证所有测试通过

### Phase 3: 前端测试编写（2-3天）
- 编写 App.test.tsx
- Mock VM 执行（可选，加速测试）
- 验证用户交互

### Phase 4: 文档和优化（1天）
- 编写 docs/TESTING.md
- 更新 AGENTS.md 和 WORKFLOW.md
- 优化测试性能
- 最终验收

---

## Related Documents

- **[AGENTS.md](../../AGENTS.md)** - Agent behavior guide (TDD section)
- **[docs/superpowers/specs/2026-05-11-complete-tdd-testing-infrastructure-design.md](../specs/2026-05-11-complete-tdd-testing-infrastructure-design.md)** - Design specification
- **[docs/superpowers/plans/2026-05-11-complete-tdd-testing-infrastructure.md](../plans/2026-05-11-complete-tdd-testing-infrastructure.md)** - Implementation plan
- **[docs/WORKFLOW.md](../WORKFLOW.md)** - Development workflow (TDD process)

---

## References

- **[Jest Official Documentation](https://jestjs.io/)** - Testing framework documentation
- **[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)** - React component testing
- **[Test-Driven Development](https://en.wikipedia.org/wiki/Test-driven_development)** - TDD methodology
- **[AGENTS.md TDD Section](../../AGENTS.md#test-driven-development-tdd)** - Project TDD requirements

---

**Last Updated**: 2026-05-11  
**Next Review**: After implementation completion or when testing strategy needs adjustment

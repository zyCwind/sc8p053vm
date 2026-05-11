# 002 - 采用 ESLint + Prettier 进行代码质量约束

## 状态

已采纳

## 背景

项目需要为新人 agent 建立编码规范约束机制，确保代码质量和风格一致性。随着项目发展，手动代码审查效率低下且容易遗漏风格问题。

## 决策

采用 **ESLint + Prettier** 组合作为项目的代码质量约束工具。

### 技术选型理由

1. **ESLint**
   - 成熟的 JavaScript/TypeScript 代码质量检查工具
   - 丰富的规则生态系统和插件支持
   - 强大的自动修复能力
   - 良好的 IDE 集成

2. **Prettier**
   - 专注于代码格式化的工具
   -  Opinionated（有主见的）默认配置减少争论
   - 与 ESLint 完美配合（通过 eslint-config-prettier）

3. **版本选择**
   - ESLint 7.x：兼容项目当前 Node.js 16 环境
   - @typescript-eslint 4.x：与 ESLint 7.x 兼容

### 配置策略

采用**分层配置**策略：
- 根目录：通用规则
- src/：Node.js/库代码专用规则
- example/：React/Web 前端专用规则

### 规则调整原则

**代码可读性优先于工具教条**：
- 允许正则表达式中的转义字符以提高可读性
- 禁用过于严格的类型限制（如 ban-types）
- 将部分错误降级为警告（如 no-non-null-assertion）

## 影响

### 积极影响

1. **代码质量提升**
   - 自动化检测常见错误和不良实践
   - 统一代码风格，减少人工审查负担
   - 帮助新人快速适应项目规范

2. **开发体验改善**
   - IDE 实时反馈问题
   - 自动修复格式问题
   - 减少代码审查中的风格争议

3. **可维护性增强**
   - 一致的代码风格提高可读性
   - 早期发现潜在问题
   - 便于团队协作

### 消极影响

1. **学习成本**
   - 新人需要学习 lint 工具使用
   - 理解规则配置需要时间

2. **初期适配工作**
   - 现有代码可能需要调整
   - 配置文件需要维护

3. **构建时间增加**
   - Lint 检查增加 CI/CD 时间
   - 但可通过缓存和优化缓解

## 替代方案考虑

### 方案二：仅 TypeScript 严格模式

**拒绝理由：**
- 无法检查代码风格和最佳实践
- 缺少自动格式化功能
- 约束能力有限

### 方案三：Husky + lint-staged

**暂不采用理由：**
- 增加配置复杂度
- 可能影响开发体验
- 可作为后续增强选项

## 实施结果

- ✅ 成功安装和配置 ESLint + Prettier
- ✅ 创建分层配置文件
- ✅ 添加 npm scripts 支持
- ✅ 更新项目文档（AGENTS.md、LINT_GUIDE.md）
- ✅ 现有代码通过 lint 检查（仅有警告）
- ✅ 创建了完整的设计和实施文档

## 参考资料

- [ESLint 官方文档](https://eslint.org/)
- [Prettier 官方文档](https://prettier.io/)
- [TypeScript ESLint](https://typescript-eslint.io/)
- `docs/superpowers/specs/2026-05-11-eslint-prettier-code-quality-design.md`
- `docs/superpowers/plans/2026-05-11-eslint-prettier-implementation-plan.md`

# Lint 工具使用指南

## 概述

本项目使用 ESLint + Prettier 来约束代码质量和风格，帮助新人 agent 快速适应项目编码规范。

## 配置文件

- `.eslintrc.js` - 根目录 ESLint 配置（通用规则）
- `.prettierrc.js` - Prettier 格式化配置
- `src/.eslintrc.js` - src 目录专用配置（Node.js/库代码规则）
- `example/.eslintrc.js` - example 目录专用配置（React/Web 规则）
- `.eslintignore` - ESLint 忽略文件列表

## 可用命令

```bash
# 检查所有 TypeScript 文件
npm run lint

# 仅检查 src 目录
npm run lint:src

# 仅检查 example 目录
npm run lint:example

# 自动修复可修复的问题
npm run lint:fix

# 格式化所有支持的文件
npm run format
```

## 编码规范

### 通用规则
- 4 空格缩进
- 单引号
- 语句末尾加分号
- 最大行长度 100 字符
- 尾随逗号

### src/ 目录（核心库）
- 禁止使用 console.log（警告级别）
- 允许 require 语法
- 严格的 TypeScript 类型检查

### example/ 目录（React 前端）
- React Hooks 规则
- JSX 最佳实践
- 禁用 prop-types（TypeScript 已提供类型检查）

## 常见问题

### 换行符问题
Windows 系统可能遇到 CRLF vs LF 问题，Prettier 已配置为 `endOfLine: 'auto'` 自动处理。

### 正则表达式转义
为了代码可读性，允许在正则表达式中使用转义字符（如 `/[\[\]]/g`），即使某些转义在技术上是可选的。

### Node.js 版本兼容性
当前使用 ESLint 7.x 以兼容 Node.js 16，部分新特性可能不可用。

### TypeScript 版本警告
由于 ESLint 插件版本限制，可能会看到 TypeScript 版本不支持的警告，但不影响正常使用。

## 最佳实践

1. **提交前检查**：在 git commit 前运行 `npm run lint` 确保代码符合规范
2. **自动修复**：优先使用 `npm run lint:fix` 自动修复格式问题
3. **手动处理**：对于无法自动修复的问题，需要手动修改代码
4. **IDE 集成**：建议在 IDE 中安装 ESLint 和 Prettier 插件实现实时检查

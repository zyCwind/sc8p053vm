module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended'
  ],
  rules: {
    'prettier/prettier': ['error', { endOfLine: 'auto' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/ban-types': 'off', // 允许使用 {} 类型
    '@typescript-eslint/no-non-null-assertion': 'warn', // 降级为警告
    '@typescript-eslint/no-empty-function': 'warn',
    'no-dupe-else-if': 'warn',
    'no-useless-escape': 'off', // 允许正则表达式中的转义字符以提高可读性
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
};

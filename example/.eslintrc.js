module.exports = {
  plugins: ['react', 'react-hooks'],
  extends: [
    'plugin:react/recommended',
    'plugin:react-hooks/recommended'
  ],
  settings: {
    react: {
      version: 'detect'
    }
  },
  rules: {
    'react/prop-types': 'off', // TypeScript 已提供类型检查
    'react/react-in-jsx-scope': 'off', // React 17+ 不需要
  }
};

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.tsx'],
    moduleNameMapper: {
        '^sc8p053vm$': '<rootDir>/../dist/index.js',
        '\\.(css|less|scss)$': 'identity-obj-proxy',
    },
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: {
                    target: 'es2017',
                    module: 'commonjs',
                    esModuleInterop: true,
                },
            },
        ],
    },
};

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', esModuleInterop: true, module: 'commonjs', moduleResolution: 'node', isolatedModules: true } }],
  },
  moduleNameMapper: { '\\.(css)$': 'identity-obj-proxy', '^@fontsource/.*$': 'identity-obj-proxy' },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/main.tsx', '!src/**/*.d.ts', '!src/setupTests.ts', '!src/test/**'],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  reporters: ['default', ['jest-junit', { outputDirectory: '../reports', outputName: 'jest-junit.xml', titleTemplate: '{title}', classNameTemplate: '{classname}', ancestorSeparator: ' › ' }]],
};

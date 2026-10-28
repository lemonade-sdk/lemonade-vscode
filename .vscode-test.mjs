import { defineConfig } from '@vscode/test-cli';
import process from 'node:process';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  ...(process.env.VSCODE_TEST_EXECUTABLE_PATH ? {
    useInstallation: { fromPath: process.env.VSCODE_TEST_EXECUTABLE_PATH }
  } : {}),
  mocha: {
    ui: 'tdd',
    timeout: 20000,
    color: true
  }
});
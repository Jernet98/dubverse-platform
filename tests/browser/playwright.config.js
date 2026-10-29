import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'player.spec.js', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    channel: process.env.PLAYER_BROWSER_CHANNEL || 'chrome' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1365, height: 900 } } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-layout', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } }
  ],
  webServer: { command: 'npm start -- --port 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI }
});

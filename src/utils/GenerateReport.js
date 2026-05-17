const report = require('multiple-cucumber-html-reporter');
const path = require('path');
const fs = require('fs');

const jsonDir = path.join(__dirname, '../../reports/cucumber-json');
const outputDir = path.join(__dirname, '../../reports/html');

// Ensure directories exist
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

report.generate({
  jsonDir,
  reportPath: outputDir,
  metadata: {
    browser: {
      name: process.env.BROWSER || 'chromium',
      version: 'latest',
    },
    device: 'Local',
    platform: {
      name: process.platform,
      version: process.version,
    },
  },
  customData: {
    title: 'Playwright BDD Test Run',
    data: [
      { label: 'Project', value: 'Playwright BDD Framework' },
      { label: 'Environment', value: process.env.ENV || 'qa' },
      { label: 'Run Date', value: new Date().toISOString() },
    ],
  },
  displayDuration: true,
  displayReportTime: true,
  openReportInBrowser: false,
  disableLog: false,
  pageTitle: 'Playwright BDD Test Report',
  reportName: 'Playwright BDD Framework - Test Results',
});

console.log('✅ HTML report generated at:', outputDir);

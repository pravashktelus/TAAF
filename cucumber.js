const fs = require('fs');

// Ensure directories exist
if (!fs.existsSync('reports/allure-results')) {
  fs.mkdirSync('reports/allure-results', { recursive: true });
}

module.exports = {
  default: {
    requireModule: ['ts-node/register'],
    require: ['src/core/CustomWorld.ts', 'src/hooks/Hooks.ts', 'src/steps/**/*.ts'],
    paths: ['features/**/*.feature'],
    format: [
      'progress-bar',
      'json:reports/cucumber-json/cucumber-report.json',
      'html:reports/html/cucumber-report.html',
    ],
    formatOptions: {
      snippetInterface: 'async-await'
    },
    worldParameters: {},
    parallel: 1
  },
  smoke: {
    requireModule: ['ts-node/register'],
    require: ['src/core/CustomWorld.ts', 'src/hooks/Hooks.ts', 'src/steps/**/*.ts'],
    paths: ['features/**/*.feature'],
    tags: '@smoke',
    format: [
      'progress-bar',
      'json:reports/cucumber-json/cucumber-smoke-report.json',
      'html:reports/html/cucumber-smoke-report.html',
    ],
  }
};

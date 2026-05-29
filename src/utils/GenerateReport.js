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
    title: 'TeleConnect Test Automation Report',
    data: [
      { label: 'Project', value: 'TeleConnect - Broadband Order Management' },
      { label: 'Team', value: 'QA Automation - Ashish Vats' },
      { label: 'Environment', value: process.env.ENV || 'qa' },
      { label: 'Run Date', value: new Date().toISOString() },
      { label: 'Framework', value: 'Playwright BDD with Self-Healing Locators' },
    ],
  },
  displayDuration: true,
  displayReportTime: true,
  openReportInBrowser: false,
  disableLog: false,
  pageTitle: 'TeleConnect - Test Automation Report',
  reportName: 'TeleConnect Test Automation Report',
  theme: 'bootstrap',
  ignoreBadJsonFile: true,
});

// Customize the HTML report
const indexPath = path.join(outputDir, 'index.html');
if (fs.existsSync(indexPath)) {
  let content = fs.readFileSync(indexPath, 'utf8');
  
  // Remove entire footer section with Wasiq references
  content = content.replace(
    /<footer[^>]*>[\s\S]*?<\/footer>/gi,
    '<footer style="text-align: center; padding: 20px; color: #666; font-size: 12px;">© 2026 TeleConnect QA Automation Team. All rights reserved.</footer>'
  );
  
  // Remove any remaining Wasiq links and text
  content = content.replace(
    /<a[^>]*href="https:\/\/(www\.)?(youtube|github|linkedin|stackoverflow)[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    ''
  );
  
  // Remove Wasiq text variations
  content = content.replace(/Maintained by Wasiq Bhamla[^<]*/gi, '');
  content = content.replace(/Maintained by Wasim[^<]*/gi, '');
  content = content.replace(/Find me on:/gi, '');
  content = content.replace(/Wasiq Bhamla/gi, '');
  content = content.replace(/Wasim/gi, '');
  
  // Remove any divs or spans containing Wasiq/Wasim references
  content = content.replace(/<(div|span|p)[^>]*>[\s\S]*?(Wasiq|Wasim|Find me on)[\s\S]*?<\/\1>/gi, '');
  
  // Remove social media icons section if present
  content = content.replace(/<div[^>]*class="[^"]*social[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  
  // Add aggressive CSS to hide Status, Device, OS, Browser, Date columns
  const customCSS = `
    <style>
      /* Hide Status, Device, OS, Browser, Date columns */
      table thead tr th:nth-child(2),
      table tbody tr td:nth-child(2),
      table thead tr th:nth-child(3),
      table tbody tr td:nth-child(3),
      table thead tr th:nth-child(4),
      table tbody tr td:nth-child(4),
      table thead tr th:nth-child(5),
      table tbody tr td:nth-child(5),
      table thead tr th:nth-child(6),
      table tbody tr td:nth-child(6) {
        display: none !important;
        visibility: hidden !important;
        width: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      
      /* Adjust remaining columns width */
      table.table th:first-child,
      table.table td:first-child {
        width: 45% !important;
      }
      
      table.table th:nth-child(7),
      table.table td:nth-child(7) {
        width: 15% !important;
      }
      
      table.table th:nth-child(8),
      table.table td:nth-child(8) {
        width: 12% !important;
      }
      
      table.table th:nth-child(9),
      table.table td:nth-child(9) {
        width: 12% !important;
      }
      
      table.table th:nth-child(10),
      table.table td:nth-child(10) {
        width: 12% !important;
      }
    </style>
  `;
  
  // Insert custom CSS before closing head tag
  content = content.replace('</head>', customCSS + '</head>');
  
  fs.writeFileSync(indexPath, content, 'utf8');
}

console.log('✅ HTML report generated at:', outputDir);
console.log('📊 Report customized for TeleConnect team');
console.log('🔒 All third-party references removed');
console.log('📋 Table columns optimized - showing: Feature name | Duration | Total | Passed | Failed');

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateAllureResults() {
  const cucumberReportPath = 'reports/cucumber-json/cucumber-report.json';
  const allureResultsDir = 'reports/allure-results';

  if (!fs.existsSync(allureResultsDir)) {
    fs.mkdirSync(allureResultsDir, { recursive: true });
  }

  try {
    if (!fs.existsSync(cucumberReportPath)) {
      console.log('No cucumber report found. Run tests first with: npm test');
      return;
    }

    const cucumberData = JSON.parse(fs.readFileSync(cucumberReportPath, 'utf8'));
    
    // Load all step timing files
    const stepTimingsMap = new Map();
    const timingFiles = fs.readdirSync(allureResultsDir)
      .filter(f => f.startsWith('step-timings-') && f.endsWith('.json'));
    
    timingFiles.forEach(file => {
      try {
        const timingData = JSON.parse(fs.readFileSync(path.join(allureResultsDir, file), 'utf8'));
        stepTimingsMap.set(file, timingData);
      } catch (e) {
        console.warn(`Failed to read timing file ${file}: ${e.message}`);
      }
    });

    let totalResults = 0;

    cucumberData.forEach((feature) => {
      if (!feature.elements) return;
      
      feature.elements.forEach((scenario) => {
        const resultId = generateUUID();
        const scenarioStatus = getScenarioStatus(scenario);
        
        // Try to find the timing file for this scenario
        let scenarioTimings = null;
        for (const [fileName, timings] of stepTimingsMap) {
          if (fileName.includes(scenario.name.replace(/\s+/g, '-'))) {
            scenarioTimings = timings;
            break;
          }
        }

        const scenarioStart = Date.now() - calculateDuration(scenario);
        const scenarioStop = Date.now();

        const allureResult = {
          uuid: resultId,
          historyId: generateUUID(),
          fullName: `${feature.name}: ${scenario.name}`,
          labels: [
            { name: 'suite', value: feature.name },
            { name: 'subSuite', value: scenario.name },
            { name: 'feature', value: feature.name },
            { name: 'story', value: scenario.name },
            { name: 'thread', value: '1' },
            { name: 'host', value: 'localhost' },
            { name: 'language', value: 'javascript' },
            { name: 'framework', value: 'cucumber-js' },
            ...(scenario.tags || []).map(t => ({ name: 'tag', value: t.name }))
          ],
          links: [],
          name: scenario.name,
          status: scenarioStatus,
          stage: 'finished',
          steps: scenario.steps.map((step, idx) => {
            const stepAttachments = [];
            const cucumberStatus = step.result?.status || 'skipped';
            let stepStatus = cucumberStatus;
            if (cucumberStatus === 'undefined') stepStatus = 'broken';
            if (cucumberStatus === 'pending') stepStatus = 'skipped';
            if (cucumberStatus === 'ambiguous') stepStatus = 'broken';
            
            const stepDuration = step.result?.duration || 0;
            const stepStart = Date.now() - (scenario.steps.length - idx) * 1000;
            const stepStop = stepStart + Math.round(stepDuration / 1000000);
            
            // Add exception message only if step failed
            if (stepStatus === 'failed' && step.result?.error_message) {
              const attachmentId = generateUUID();
              stepAttachments.push({
                name: 'Exception',
                source: `${attachmentId}-exception.txt`,
                type: 'text/plain'
              });
              
              // Write exception file
              const exceptionPath = path.join(allureResultsDir, `${attachmentId}-exception.txt`);
              fs.writeFileSync(exceptionPath, step.result.error_message);
            }
            
            // Add embeddings (screenshots, logs, text/html RCA reports, etc.)
            if (step.embeddings && Array.isArray(step.embeddings)) {
              step.embeddings.forEach(embedding => {
                if (embedding.data && embedding.mime_type) {
                  const attachmentId = generateUUID();
                  const mediaType = embedding.mime_type;
                  let ext = '.txt';
                  
                  if (mediaType.includes('png')) {
                    ext = '.png';
                  } else if (mediaType.includes('image/jpeg')) {
                    ext = '.jpg';
                  } else if (mediaType.includes('text/html')) {
                    ext = '.html';
                  } else if (mediaType.includes('text/plain')) {
                    ext = '.txt';
                  }
                  
                  stepAttachments.push({
                    name: embedding.name || `Attachment ${attachmentId.substring(0, 8)}`,
                    source: `${attachmentId}-attachment${ext}`,
                    type: mediaType
                  });
                  
                  // Write attachment file
                  const attachmentPath = path.join(allureResultsDir, `${attachmentId}-attachment${ext}`);
                  fs.writeFileSync(attachmentPath, Buffer.from(embedding.data, 'base64'));
                }
              });
            }
            
            return {
              name: `${step.keyword || ''}${step.name || ''}`.trim(),
              status: stepStatus,
              stage: 'finished',
              start: stepStart,
              stop: stepStop,
              attachments: stepAttachments,
              statusDetails: stepStatus === 'failed' ? { message: step.result?.error_message?.split('\n')[0] || '' } : {}
            };
          }),
          attachments: [],
          parameters: [],
          start: scenarioStart,
          stop: scenarioStop,
          description: scenario.description || '',
        };

        const resultPath = path.join(allureResultsDir, `${resultId}-result.json`);
        fs.writeFileSync(resultPath, JSON.stringify(allureResult, null, 2));
        
        totalResults++;
      });
    });

    // Clean up step timing files after processing
    timingFiles.forEach(file => {
      try {
        fs.unlinkSync(path.join(allureResultsDir, file));
      } catch (e) {
        console.warn(`Failed to delete timing file ${file}: ${e.message}`);
      }
    });

    console.log(`✓ Allure results generated successfully - ${totalResults} test cases`);
    console.log(`  Location: reports/allure-results/`);
  } catch (error) {
    console.error('Error generating Allure results:', error.message);
    process.exit(1);
  }
}

function getScenarioStatus(scenario) {
  if (!scenario.steps || scenario.steps.length === 0) {
    return 'skipped';
  }

  const allStatuses = scenario.steps.map((s) => s.result?.status);

  if (allStatuses.includes('failed')) return 'failed';
  if (allStatuses.includes('undefined')) return 'skipped';
  if (allStatuses.includes('pending')) return 'skipped';
  if (allStatuses.every((s) => s === 'passed')) return 'passed';

  return 'unknown';
}

function calculateDuration(scenario) {
  if (!scenario.steps) return 0;

  const totalNanos = scenario.steps.reduce((sum, step) => {
    return sum + (step.result?.duration || 0);
  }, 0);

  return Math.round(totalNanos / 1000000);
}

generateAllureResults();

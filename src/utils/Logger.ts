import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const LOG_DIR = 'reports/logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Clean old logs before each run
const cleanLogs = () => {
  try {
    const files = fs.readdirSync(LOG_DIR);
    files.forEach((file) => {
      const filePath = path.join(LOG_DIR, file);
      fs.unlinkSync(filePath);
    });
  } catch (e) {
    // Ignore errors during cleanup
  }
};

cleanLogs();

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const lvl = level.toUpperCase().padEnd(5);
    const msg = stack ? `${message}\n${stack}` : message;
    return `[${timestamp}] ${lvl} | ${msg}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'warn',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'test-run.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'errors.log'),
      level: 'error',
    }),
  ],
});

// Structured logger wrapping winston for consistent test output.
export class Logger {
  // Logs a debug-level message (only visible when LOG_LEVEL=debug)
  // Usage: Logger.debug("Resolved locator: #submit-btn")
  static debug(message: string): void {
    logger.debug(message);
  }

  // Logs an info-level message
  // Usage: Logger.info("Navigating to login page")
  static info(message: string): void {
    logger.info(message);
  }

  // Logs a warning-level message
  // Usage: Logger.warn("Element took longer than expected to load")
  static warn(message: string): void {
    logger.warn(message);
  }

  // Logs an error message or Error object with stack trace
  // Usage: Logger.error("Login failed") or Logger.error(new Error("timeout"))
  static error(message: string | Error): void {
    if (message instanceof Error) {
      logger.error(message.message, { stack: message.stack });
    } else {
      logger.error(message);
    }
  }

  // Logs a test step execution marker
  // Usage: Logger.step("Click on Submit button")
  static step(stepName: string): void {
    logger.info(`▶ STEP: ${stepName}`);
  }

  // Logs a scenario header with visual separator
  // Usage: Logger.scenario("User login with valid credentials")
  static scenario(scenarioName: string): void {
    logger.info(`\n${'═'.repeat(70)}`);
    logger.info(`  SCENARIO: ${scenarioName}`);
    logger.info(`${'═'.repeat(70)}`);
  }

  // Logs a passed test result
  // Usage: Logger.testPassed("User login with valid credentials")
  static testPassed(scenarioName: string): void {
    logger.info(`✅ PASSED: ${scenarioName}`);
  }

  // Logs a failed test result with optional error detail
  // Usage: Logger.testFailed("Login test", "Element not found")
  static testFailed(scenarioName: string, error?: string): void {
    logger.error(`❌ FAILED: ${scenarioName}${error ? `\n   Error: ${error}` : ''}`);
  }
}

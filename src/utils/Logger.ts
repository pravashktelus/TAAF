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
  static debug(message: string): void {
    logger.debug(message);
  }

  static info(message: string): void {
    logger.info(message);
  }

  static warn(message: string): void {
    logger.warn(message);
  }

  static error(message: string | Error): void {
    if (message instanceof Error) {
      logger.error(message.message, { stack: message.stack });
    } else {
      logger.error(message);
    }
  }

  static step(stepName: string): void {
    logger.info(`▶ STEP: ${stepName}`);
  }

  static scenario(scenarioName: string): void {
    logger.info(`\n${'═'.repeat(70)}`);
    logger.info(`  SCENARIO: ${scenarioName}`);
    logger.info(`${'═'.repeat(70)}`);
  }

  static testPassed(scenarioName: string): void {
    logger.info(`✅ PASSED: ${scenarioName}`);
  }

  static testFailed(scenarioName: string, error?: string): void {
    logger.error(`❌ FAILED: ${scenarioName}${error ? `\n   Error: ${error}` : ''}`);
  }
}

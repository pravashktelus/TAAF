import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber';
import { Page } from '@playwright/test';
import { ContextManager } from '../core/ContextManager';
import { ActionEngine } from '../core/ActionEngine';
import { ApiEngine } from '../core/ApiEngine';
import { SelfHealingEngine } from '../core/SelfHealingEngine';
import { VisualTestingEngine } from '../core/VisualTestingEngine';
import { RootCauseAnalyzer } from '../core/RootCauseAnalyzer';
import { FrameworkConfig } from '../config/FrameworkConfig';
import { TestUserManager } from '../utils/TestUserManager';
import { DataStore } from '../utils/DataStore';
import { Logger } from '../utils/Logger';

// Cucumber World object injected into every step definition.
export class CustomWorld extends World {
  public contextManager: ContextManager;
  public actionEngine!: ActionEngine;
  public selfHealingEngine!: SelfHealingEngine;
  public visualTestingEngine!: VisualTestingEngine;
  public rootCauseAnalyzer!: RootCauseAnalyzer;
  public apiEngine: ApiEngine;
  public testUserManager: TestUserManager;
  public scenarioName: string = '';
  public scenarioTags: string[] = [];
  public testFailed: boolean = false;
  public stepTimings: Map<string, { startTime: number; endTime: number }> = new Map();

  constructor(options: IWorldOptions) {
    super(options);
    this.contextManager = new ContextManager();
    this.apiEngine = new ApiEngine();
    this.testUserManager = TestUserManager.getInstance();
    Logger.debug('CustomWorld created');
  }

  public initActionEngine(): void {
    const page: Page = this.contextManager.getPage();
    const config = FrameworkConfig.getInstance();

    this.actionEngine = new ActionEngine(page);
    this.selfHealingEngine = new SelfHealingEngine(page);
    this.visualTestingEngine = new VisualTestingEngine(page);
    this.rootCauseAnalyzer = new RootCauseAnalyzer(page);

    if (config.selfHealing.enabled) {
      this.actionEngine.setSelfHealingEngine(this.selfHealingEngine);
      this.actionEngine.setVisualTestingEngine(this.visualTestingEngine);
      
      // Pass attach callback to SelfHealingEngine so it can attach screenshots to report
      this.selfHealingEngine.setAttachCallback(async (buffer: Buffer, mimeType: string) => {
        await this.attach(buffer, mimeType);
      });
      
      Logger.info('Self-healing: ENABLED (configured in framework.properties)');
    } else {
      Logger.info('Self-healing: DISABLED (configured in framework.properties)');
    }
  }

  public getPage(): Page {
    return this.contextManager.getPage();
  }

  public recordAction(action: string): void {
    if (this.rootCauseAnalyzer) {
      this.rootCauseAnalyzer.recordAction(action);
    }
  }
}

setWorldConstructor(CustomWorld);

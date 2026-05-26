import { FrameworkConfig } from '../config/FrameworkConfig';

/**
 * Test User interface
 */
export interface TestUser {
  email: string;
  password: string;
  name: string;
  timestamp: number;
}

/**
 * Manages test user creation with unique email generation
 * Each test run creates a new account using the password from framework.properties
 */
export class TestUserManager {
  private static instance: TestUserManager;
  private currentUser: TestUser | null = null;
  private config: FrameworkConfig;

  private constructor() {
    this.config = FrameworkConfig.getInstance();
  }

  public static getInstance(): TestUserManager {
    if (!this.instance) {
      this.instance = new TestUserManager();
    }
    return this.instance;
  }

  /**
   * Generates a new test user with unique email
   * Email format: test-{timestamp}@{emailDomain}
   */
  public generateNewUser(): TestUser {
    const timestamp = Date.now();
    const email = `test-${timestamp}@${this.config.testUser.emailDomain}`;

    this.currentUser = {
      email,
      password: this.config.testUser.password,
      name: this.config.testUser.name,
      timestamp,
    };

    console.log(`✓ Generated new test user: ${email}`);
    return this.currentUser;
  }

  /**
   * Gets the current test user (if any)
   */
  public getCurrentUser(): TestUser | null {
    return this.currentUser;
  }

  /**
   * Gets the current test user email
   * Throws error if no user has been generated yet
   */
  public getCurrentEmail(): string {
    if (!this.currentUser) {
      throw new Error('No test user has been generated yet. Call generateNewUser() first.');
    }
    return this.currentUser.email;
  }

  /**
   * Gets the current test user password
   */
  public getPassword(): string {
    if (!this.currentUser) {
      throw new Error('No test user has been generated yet. Call generateNewUser() first.');
    }
    return this.currentUser.password;
  }

  /**
   * Gets the current test user name
   */
  public getName(): string {
    if (!this.currentUser) {
      throw new Error('No test user has been generated yet. Call generateNewUser() first.');
    }
    return this.currentUser.name;
  }

  /**
   * Resets the current user (for cleanup)
   */
  public resetUser(): void {
    this.currentUser = null;
  }
}

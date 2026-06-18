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

  // Returns singleton instance of TestUserManager
  // Usage: const mgr = TestUserManager.getInstance()
  public static getInstance(): TestUserManager {
    if (!this.instance) {
      this.instance = new TestUserManager();
    }
    return this.instance;
  }

  // Generates a new test user with unique timestamped email
  // Usage: const user = TestUserManager.getInstance().generateNewUser()
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

  // Gets the current test user object (null if not generated yet)
  // Usage: const user = mgr.getCurrentUser()
  public getCurrentUser(): TestUser | null {
    return this.currentUser;
  }

  // Gets the current test user's email (throws if no user generated)
  // Usage: const email = mgr.getCurrentEmail()
  public getCurrentEmail(): string {
    if (!this.currentUser) {
      throw new Error('No test user has been generated yet. Call generateNewUser() first.');
    }
    return this.currentUser.email;
  }

  // Gets the current test user's password (throws if no user generated)
  // Usage: const pwd = mgr.getPassword()
  public getPassword(): string {
    if (!this.currentUser) {
      throw new Error('No test user has been generated yet. Call generateNewUser() first.');
    }
    return this.currentUser.password;
  }

  // Gets the current test user's name (throws if no user generated)
  // Usage: const name = mgr.getName()
  public getName(): string {
    if (!this.currentUser) {
      throw new Error('No test user has been generated yet. Call generateNewUser() first.');
    }
    return this.currentUser.name;
  }

  // Resets the current user to null (cleanup between test runs)
  // Usage: mgr.resetUser()
  public resetUser(): void {
    this.currentUser = null;
  }
}

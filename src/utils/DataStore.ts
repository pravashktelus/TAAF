// A thread-safe in-memory key-value store scoped to a single test scenario.
export class DataStore {
  private static store: Map<string, unknown> = new Map();

  public static set(key: string, value: unknown): void {
    DataStore.store.set(key, value);
  }

  public static get<T = unknown>(key: string): T | undefined {
    return DataStore.store.get(key) as T | undefined;
  }

  public static getOrThrow<T = unknown>(key: string): T {
    if (!DataStore.store.has(key)) {
      throw new Error(
        `DataStore: key "${key}" not found. Available keys: ${DataStore.keys().join(', ')}`
      );
    }
    return DataStore.store.get(key) as T;
  }

  public static has(key: string): boolean {
    return DataStore.store.has(key);
  }

  public static delete(key: string): void {
    DataStore.store.delete(key);
  }

  public static clear(): void {
    DataStore.store.clear();
  }

  public static keys(): string[] {
    return Array.from(DataStore.store.keys());
  }

  public static dump(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    DataStore.store.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

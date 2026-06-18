// A thread-safe in-memory key-value store scoped to a single test scenario.
export class DataStore {
  private static store: Map<string, unknown> = new Map();

  // Stores a value by key for the current scenario
  // Usage: DataStore.set("userId", "12345")
  public static set(key: string, value: unknown): void {
    DataStore.store.set(key, value);
  }

  // Retrieves a stored value by key, returns undefined if not found
  // Usage: const id = DataStore.get<string>("userId")
  public static get<T = unknown>(key: string): T | undefined {
    return DataStore.store.get(key) as T | undefined;
  }

  // Retrieves a stored value or throws an error if key doesn't exist
  // Usage: const id = DataStore.getOrThrow<string>("userId")
  public static getOrThrow<T = unknown>(key: string): T {
    if (!DataStore.store.has(key)) {
      throw new Error(
        `DataStore: key "${key}" not found. Available keys: ${DataStore.keys().join(', ')}`
      );
    }
    return DataStore.store.get(key) as T;
  }

  // Checks if a key exists in the store
  // Usage: if (DataStore.has("token")) { ... }
  public static has(key: string): boolean {
    return DataStore.store.has(key);
  }

  // Removes a specific key from the store
  // Usage: DataStore.delete("tempData")
  public static delete(key: string): void {
    DataStore.store.delete(key);
  }

  // Clears all stored data (called between scenarios)
  // Usage: DataStore.clear()
  public static clear(): void {
    DataStore.store.clear();
  }

  // Returns all stored key names
  // Usage: const allKeys = DataStore.keys()
  public static keys(): string[] {
    return Array.from(DataStore.store.keys());
  }

  // Returns all stored data as a plain object (useful for debugging)
  // Usage: console.log(DataStore.dump())
  public static dump(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    DataStore.store.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

import * as fs from 'fs';
import * as path from 'path';

// Persists test data to JSON file for cross-scenario access using $$VariableName syntax.
export class PersistentStore {
  private static readonly FILE_PATH = path.resolve(process.cwd(), 'testdata/runtime-store.json');
  private static cache: Record<string, unknown> | null = null;

  // Saves a key-value pair to persistent storage (survives across scenarios)
  // Usage: PersistentStore.save("authToken", "abc123")
  static save(key: string, value: unknown): void {
    const data = this.loadAll();
    data[key] = value;
    this.writeFile(data);
    this.cache = data;
  }

  // Retrieves a value from persistent storage
  // Usage: const token = PersistentStore.get("authToken")
  static get(key: string): unknown {
    const data = this.loadAll();
    return data[key];
  }

  // Checks if a key exists in persistent storage
  // Usage: if (PersistentStore.has("authToken")) { ... }
  static has(key: string): boolean {
    const data = this.loadAll();
    return key in data;
  }

  // Loads all persisted data from the JSON file
  // Usage: const allData = PersistentStore.loadAll()
  static loadAll(): Record<string, unknown> {
    if (this.cache) return this.cache;

    if (!fs.existsSync(this.FILE_PATH)) {
      this.writeFile({});
      this.cache = {};
      return {};
    }

    try {
      const content = fs.readFileSync(this.FILE_PATH, 'utf-8');
      this.cache = JSON.parse(content);
      return this.cache!;
    } catch {
      this.cache = {};
      return {};
    }
  }

  // Clears all persisted data (resets the runtime store)
  // Usage: PersistentStore.clear()
  static clear(): void {
    this.writeFile({});
    this.cache = {};
  }

  // Replaces all $$VariableName placeholders in a string with persisted values
  // Usage: PersistentStore.resolve("Token is $$authToken")
  static resolve(value: string): string {
    return value.replace(/\$\$(\w+)/g, (_, key) => {
      const stored = this.get(key);
      if (stored === undefined) return `$$${key}`;
      return String(stored);
    });
  }

  private static writeFile(data: Record<string, unknown>): void {
    const dir = path.dirname(this.FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }
}

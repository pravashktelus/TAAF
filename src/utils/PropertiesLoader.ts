import * as fs from 'fs';
import * as path from 'path';

export class PropertiesLoader {
  private static properties: Map<string, string> = new Map();

  static {
    this.loadProperties();
  }

  private static loadProperties(): void {
    const propsPath = path.join(__dirname, '../config/framework.properties');
    const content = fs.readFileSync(propsPath, 'utf-8');
    
    content.split('\n').forEach((line) => {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim();
        this.properties.set(key.trim(), value);
      }
    });
  }

  // Gets a property value by key, with optional default fallback
  // Usage: PropertiesLoader.get("app.url", "http://localhost:3000")
  static get(key: string, defaultValue?: string): string {
    return this.properties.get(key) || defaultValue || '';
  }

  // Returns all loaded properties as a Map
  // Usage: const allProps = PropertiesLoader.getAll()
  static getAll(): Map<string, string> {
    return new Map(this.properties);
  }
}

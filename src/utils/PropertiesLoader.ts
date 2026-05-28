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

  static get(key: string, defaultValue?: string): string {
    return this.properties.get(key) || defaultValue || '';
  }

  static getAll(): Map<string, string> {
    return new Map(this.properties);
  }
}

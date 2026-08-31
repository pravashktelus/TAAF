import * as fs from 'fs';
import * as path from 'path';
import { FrameworkConfig } from '../../config/FrameworkConfig';
import { SourceRepoScanner, SourceIndex, SourceLocator, SourceValidation } from './SourceRepoScanner';

/**
 * SourceIndexProvider
 * -------------------
 * Thin façade over SourceRepoScanner that the Planner and Generator use.
 *
 *   • Reads agents.appRepo.* config (enabled, path, indexPath, pageMap).
 *   • Loads a cached source-index.json if present, else scans the repo on demand.
 *   • Maps the dev repo's route segments to the framework's page names via the
 *     configured pageMap (e.g. "/customer" → "TeleConnect").
 *   • Exposes helpers to get locators / validations for a framework page.
 *
 * When the repo isn't configured/available it degrades gracefully (returns
 * empty), so the pipeline behaves exactly as before source-repo integration.
 */
export class SourceIndexProvider {
  private index: SourceIndex | null = null;
  private pageMap: Record<string, string> = {}; // route -> framework page name
  private enabled = false;

  // Process-level memo — reused across multiple constructions in one run.
  private static _memoIndex: SourceIndex | null | undefined = undefined;
  private static _memoRepoPath: string | undefined = undefined;

  constructor() {
    const config = FrameworkConfig.getInstance();
    this.enabled = config.get('agents.appRepo.enabled', 'false') === 'true';
    if (!this.enabled) return;

    const repoPath = config.get('agents.appRepo.path', '');
    const indexPath = config.get('agents.appRepo.indexPath', 'generated/source-index.json');
    this.pageMap = this._parsePageMap(config.get('agents.appRepo.pageMap', ''));

    // ── Process-level memo ─────────────────────────────────────────────────
    // The Generator constructs SourceIndexProvider several times per run
    // (coverage pre-check, seeding, guardrail). Reuse the same scan within a
    // single process instead of re-parsing the repo each time.
    if (SourceIndexProvider._memoIndex !== undefined && SourceIndexProvider._memoRepoPath === repoPath) {
      this.index = SourceIndexProvider._memoIndex;
      return;
    }

    try {
      const scanner = new SourceRepoScanner(repoPath);
      const absIndexPath = path.resolve(process.cwd(), indexPath);

      if (scanner.isAvailable()) {
        // ── Freshness-aware cache ────────────────────────────────────────
        // Re-scan only when the cache is missing or STALE (older than the
        // newest source file). Scanning 124 files is cheap, but skipping it
        // when nothing changed shaves time off repeated runs.
        if (this._cacheIsFresh(absIndexPath, repoPath)) {
          this.index = JSON.parse(fs.readFileSync(absIndexPath, 'utf-8'));
          console.log('[SourceIndexProvider] Using cached source index (up to date).');
        } else {
          this.index = scanner.scan();
          try { scanner.writeIndex(this.index, absIndexPath); } catch { /* non-fatal */ }
        }
      } else if (fs.existsSync(absIndexPath)) {
        // Repo not present locally — fall back to whatever cache exists.
        this.index = JSON.parse(fs.readFileSync(absIndexPath, 'utf-8'));
      }
    } catch (err) {
      console.warn(`[SourceIndexProvider] Source repo scan failed (continuing without it): ${(err as Error).message}`);
      this.index = null;
    }

    // Memoize for the rest of this process.
    SourceIndexProvider._memoIndex = this.index;
    SourceIndexProvider._memoRepoPath = repoPath;
  }

  /**
   * True when the cached index exists AND is newer than the most-recently
   * modified source file under the repo's src/. If any source file changed
   * after the cache was written, the cache is stale → re-scan.
   */
  private _cacheIsFresh(indexPath: string, repoPath: string): boolean {
    try {
      if (!fs.existsSync(indexPath)) return false;
      const cacheMtime = fs.statSync(indexPath).mtimeMs;
      const srcDir = path.join(repoPath, 'src');
      const newest = this._newestMtime(srcDir);
      return newest > 0 && cacheMtime >= newest;
    } catch {
      return false; // any error → treat as stale, re-scan
    }
  }

  /** Recursively finds the newest mtime among source files (.tsx/.ts) under a dir. */
  private _newestMtime(dir: string): number {
    let newest = 0;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          newest = Math.max(newest, this._newestMtime(full));
        } else if (/\.tsx?$/.test(entry.name)) {
          newest = Math.max(newest, fs.statSync(full).mtimeMs);
        }
      }
    } catch { /* ignore */ }
    return newest;
  }

  /** True when a source index is loaded and usable. */
  isAvailable(): boolean {
    return this.enabled && !!this.index && this.index.locators.length > 0;
  }

  /**
   * Returns source-derived locators for a framework page (e.g. "TeleConnect"),
   * resolving all dev routes that map to that page. Keys are made unique.
   */
  getLocatorsForPage(pageName: string): SourceLocator[] {
    if (!this.isAvailable()) return [];
    const routes = this._routesForPage(pageName);
    const result: SourceLocator[] = [];
    const seenKey = new Set<string>();
    for (const loc of this.index!.locators) {
      if (!routes.has(loc.route)) continue;
      if (seenKey.has(loc.key)) continue; // first wins (dedupe by key)
      seenKey.add(loc.key);
      result.push(loc);
    }
    return result;
  }

  /**
   * Returns source-derived validation rules (field → message, with error element)
   * for a framework page. Feeds HONEST negative-case generation.
   */
  getValidationsForPage(pageName: string): SourceValidation[] {
    if (!this.isAvailable()) return [];
    const routes = this._routesForPage(pageName);
    return this.index!.validations.filter((v) => routes.has(v.route));
  }

  /** All lifecycle status values discovered in source (for status assertions). */
  getStatusValues(): string[] {
    return this.isAvailable() ? this.index!.statusValues : [];
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _routesForPage(pageName: string): Set<string> {
    const routes = new Set<string>();
    for (const [route, page] of Object.entries(this.pageMap)) {
      if (page.toLowerCase() === pageName.toLowerCase()) routes.add(route);
    }
    return routes;
  }

  private _parsePageMap(raw: string): Record<string, string> {
    const map: Record<string, string> = {};
    raw.split(',').forEach((pair) => {
      const [route, page] = pair.split('=').map((s) => s.trim());
      if (route && page) map[route] = page;
    });
    return map;
  }
}

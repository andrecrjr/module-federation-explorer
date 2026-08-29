import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { suite, test } from 'mocha';

interface DependencyRule {
  sourceArea: string;
  target: RegExp;
  reason: string;
}

const dependencyRules: readonly DependencyRule[] = [
  {
    sourceArea: 'federation',
    target: /^(app|features|infrastructure)(\/|$)/,
    reason: 'federation models stay independent from application, feature, and runtime layers'
  },
  {
    sourceArea: 'parser',
    target: /^(app|features|infrastructure)(\/|$)/,
    reason: 'parser utilities stay independent from application, feature, and runtime layers'
  },
  {
    sourceArea: 'extractors',
    target: /^(app|features|infrastructure)(\/|$)/,
    reason: 'extractors stay independent from application, feature, and runtime layers'
  },
  {
    sourceArea: 'features',
    target: /^app\/(compositionRoot|lifecycle|registerCommands)(\/|$)/,
    reason: 'features do not own composition or global lifecycle registration'
  },
  {
    sourceArea: 'features',
    target: /^infrastructure\/vscode(\/|$)/,
    reason: 'features use application ports instead of VS Code adapters'
  },
  {
    sourceArea: 'infrastructure/vscode',
    target: /^features(\/|$)/,
    reason: 'VS Code adapters do not depend on feature workflows'
  }
];

function sourceRoot(): string {
  return path.resolve(__dirname, '../../../../../src');
}

function collectProductionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && (entry.name === 'test' || entry.name === 'ui-test')) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectProductionFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

function sourceArea(filePath: string): string {
  return path.relative(sourceRoot(), filePath).split(path.sep)[0] ?? '';
}

function moduleId(filePath: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const resolved = path.resolve(path.dirname(filePath), specifier);
  return path.relative(sourceRoot(), resolved).split(path.sep).join('/');
}

function importsFrom(source: string): string[] {
  const imports: string[] = [];
  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

function findViolations(): string[] {
  const root = sourceRoot();
  const violations: string[] = [];
  for (const filePath of collectProductionFiles(root)) {
    const area = sourceArea(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    for (const specifier of importsFrom(source)) {
      const target = moduleId(filePath, specifier);
      if (!target) continue;
      for (const rule of dependencyRules) {
        if (area !== rule.sourceArea || !rule.target.test(target)) continue;
        violations.push(`${path.relative(root, filePath)} -> ${target}: ${rule.reason}`);
      }
    }
  }
  return violations;
}

suite('Dependency direction', () => {
  test('keeps low-level and feature imports within the architecture rules', () => {
    assert.deepStrictEqual(findViolations(), []);
  });
});

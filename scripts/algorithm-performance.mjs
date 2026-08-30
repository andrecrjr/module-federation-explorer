#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { resolveConfigExpressionToObject } = require(path.join(repositoryRoot, 'out/test/extractors/configObject.js'));
const { RemoteConfigurationService } = require(
  path.join(repositoryRoot, 'out/test/features/remotes/remoteConfigurationService.js')
);
const { buildRemoteExposedModulesIndex } = require(
  path.join(repositoryRoot, 'out/test/features/explorer/treeModel.js')
);
const { GraphGenerator } = require(path.join(repositoryRoot, 'out/test/features/graph/generator.js'));

const sizes = [25, 100, 250, 500];
const iterations = 12;

function makeRemote(name) {
  return {
    name,
    folder: `/workspace/${name}`,
    packageManager: 'npm',
    configType: 'webpack'
  };
}

function makeConfig(index, size) {
  const appName = `app-${index}`;
  const nextAppName = `app-${(index + 1) % size}`;
  return {
    name: appName,
    remotes: [makeRemote(nextAppName)],
    exposes: [
      {
        name: `Module${index}`,
        path: `./src/Module${index}.tsx`,
        remoteName: appName
      }
    ],
    shared: [{ name: 'react', version: index % 2 === 0 ? '18' : '17' }],
    detected: true,
    configType: 'webpack',
    configPath: `/workspace/${appName}/webpack.config.ts`
  };
}

function makeConfigMap(size) {
  const configs = new Map();
  for (let index = 0; index < size; index += 1) {
    configs.set(`/workspace/root-${index}`, [makeConfig(index, size)]);
  }
  return configs;
}

function makeAliasAst(size) {
  const direct = { type: 'ObjectExpression', properties: [] };
  const body = [];
  for (let index = 0; index < size; index += 1) {
    body.push({
      type: 'VariableDeclaration',
      declarations: [
        {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: `unrelated${index}` },
          init: { type: 'Literal', value: index }
        }
      ]
    });
  }
  for (let index = 0; index < size; index += 1) {
    body.push({
      type: 'VariableDeclaration',
      declarations: [
        {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: `alias${index}` },
          init: { type: 'Identifier', name: index === size - 1 ? 'config' : `alias${index + 1}` }
        }
      ]
    });
  }
  body.push({
    type: 'VariableDeclaration',
    declarations: [{ type: 'VariableDeclarator', id: { type: 'Identifier', name: 'config' }, init: direct }]
  });
  return { ast: { type: 'Program', body }, expression: { type: 'Identifier', name: 'alias0' } };
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = ratio => {
    const position = (sorted.length - 1) * ratio;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return { median: percentile(0.5), p95: percentile(0.95) };
}

function measure(operation) {
  for (let index = 0; index < 2; index += 1) operation();
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }
  return summarize(values);
}

async function measureAsync(operation) {
  for (let index = 0; index < 2; index += 1) await operation();
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    values.push(performance.now() - started);
  }
  return summarize(values);
}

function format(summary) {
  return `${summary.median.toFixed(2)} / ${summary.p95.toFixed(2)} ms`;
}

async function main() {
  const generator = new GraphGenerator();
  const remoteConfigurationService = new RemoteConfigurationService({
    rootConfigurationStore: { loadRootConfig: async () => null, saveRootConfig: async () => {} },
    getRootConfigs: () => new Map(),
    fileSystem: {
      existsSync: () => false,
      statSync: () => ({ isFile: () => false, isDirectory: () => false })
    },
    path: {
      isAbsolute: filePath => filePath.startsWith('/'),
      resolve: (...parts) => path.posix.resolve(...parts),
      dirname: filePath => path.posix.dirname(filePath)
    },
    log: () => {},
    logError: () => {}
  });

  console.log('Algorithm benchmark (median / p95, milliseconds; 2 warmups + 12 measured runs)');
  console.log('size | graph generation | AST alias resolution | hydration | tree remote index');
  console.log('-----|------------------|-----------------------|-----------|------------------');

  for (const size of sizes) {
    const configs = makeConfigMap(size);
    const alias = makeAliasAst(size);
    const graph = measure(() => generator.generate(configs));
    const ast = measure(() => resolveConfigExpressionToObject(alias.expression, alias.ast));
    const hydration = await measureAsync(() => remoteConfigurationService.hydrateRemoteConfigurations(configs));
    const tree = measure(() => buildRemoteExposedModulesIndex(configs));
    console.log(
      `${String(size).padStart(4)} | ${format(graph).padStart(16)} | ${format(ast).padStart(21)} | ${format(hydration).padStart(9)} | ${format(tree).padStart(17)}`
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

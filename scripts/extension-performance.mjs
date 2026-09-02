#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vscodeVersion = '1.135.0';
const defaultTimeoutMs = 60_000;

function help() {
  console.log(`Usage: npm run perf:extension -- [options]

Options:
  --base <ref>       Baseline Git ref (default: master)
  --head <ref>       Candidate Git ref (default: HEAD)
  --runs <number>    Runs per ref and mode (default: 5)
  --mode <modes>     Comma-separated modes: cold,warm (default: cold,warm)
  --out <directory>  Report directory (default: reports/refactor)
  --vscode <path>    VS Code executable (default: cached ${vscodeVersion})
  --help             Show this help
`);
}

function parseOptions(argv) {
  const options = {
    base: 'master',
    head: 'HEAD',
    runs: 5,
    modes: ['cold', 'warm'],
    out: path.join(repositoryRoot, 'reports/refactor'),
    vscode: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      help();
      process.exit(0);
    }
    if (!['--base', '--head', '--runs', '--mode', '--out', '--vscode'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--base') options.base = value;
    if (argument === '--head') options.head = value;
    if (argument === '--runs') options.runs = Number(value);
    if (argument === '--mode') options.modes = value.split(',').filter(Boolean);
    if (argument === '--out') options.out = path.resolve(repositoryRoot, value);
    if (argument === '--vscode') options.vscode = path.resolve(value);
  }

  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error('--runs must be a positive integer');
  if (options.modes.length === 0 || options.modes.some(mode => !['cold', 'warm'].includes(mode))) {
    throw new Error('--mode must contain only cold and/or warm');
  }
  return options;
}

async function capture(command, args, cwd) {
  const result = await execFileAsync(command, args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

async function runUnderVirtualDisplayIfNeeded() {
  if (
    process.platform !== 'linux' ||
    process.env.DISPLAY ||
    process.env.MFE_EXTENSION_PERF_XVFB === '1' ||
    !existsSync('/usr/bin/xvfb-run')
  ) {
    return false;
  }

  await run('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], repositoryRoot, {
    ...process.env,
    MFE_EXTENSION_PERF_XVFB: '1'
  });
  return true;
}

async function resolveRef(ref) {
  return capture('git', ['rev-parse', '--verify', `${ref}^{commit}`], repositoryRoot);
}

async function createWorktree(benchmarkRoot, sha, label) {
  const worktree = path.join(benchmarkRoot, `${label}-worktree`);
  await run('git', ['worktree', 'add', '--detach', worktree, sha], repositoryRoot, process.env);
  const nodeModules = path.join(repositoryRoot, 'node_modules');
  if (!existsSync(nodeModules)) throw new Error('node_modules is required to run the extension benchmark');
  await symlink(nodeModules, path.join(worktree, 'node_modules'), 'dir');
  return worktree;
}

async function removeWorktree(worktree) {
  try {
    await run('git', ['worktree', 'remove', '--force', worktree], repositoryRoot, process.env);
  } catch (error) {
    console.error(`Could not remove temporary worktree ${worktree}: ${error instanceof Error ? error.message : error}`);
  }
}

async function createFixture(benchmarkRoot) {
  const workspace = path.join(benchmarkRoot, 'workspace');
  const host = path.join(workspace, 'host');
  const vscodeDirectory = path.join(workspace, '.vscode');
  await mkdir(host, { recursive: true });
  await mkdir(vscodeDirectory, { recursive: true });

  await writeFile(
    path.join(host, 'webpack.config.js'),
    `new ModuleFederationPlugin({
  name: 'benchmark-host',
  remotes: {
    auth: 'auth@http://localhost:3001/remoteEntry.js'
  },
  exposes: {
    './App': './src/App.tsx'
  },
  shared: ['react']
});
`,
    'utf8'
  );
  await writeFile(
    path.join(host, 'package.json'),
    JSON.stringify(
      {
        name: 'benchmark-host',
        private: true,
        scripts: { start: 'node -e "process.exit(0)"' }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  await writeFile(
    path.join(host, 'mf-manifest.json'),
    JSON.stringify({ id: 'benchmark-host', name: 'benchmark-host' }),
    'utf8'
  );
  await writeFile(
    path.join(vscodeDirectory, 'mf-explorer.json'),
    JSON.stringify({ roots: [host] }, null, 2) + '\n',
    'utf8'
  );
  await writeFile(
    path.join(vscodeDirectory, 'mf-explorer.roots.json'),
    JSON.stringify({ roots: [host] }, null, 2) + '\n',
    'utf8'
  );
  return { workspace, host };
}

async function compile(worktree) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const started = performance.now();
  await run(npm, ['run', 'compile'], worktree, process.env);
  return performance.now() - started;
}

async function createExtensionOverlay(worktree, benchmarkRoot, label) {
  const overlay = path.join(benchmarkRoot, `${label}-extension`);
  await mkdir(overlay, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(worktree, 'package.json'), 'utf8'));
  manifest.activationEvents = [];
  await writeFile(path.join(overlay, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await symlink(path.join(worktree, 'dist'), path.join(overlay, 'dist'), 'dir');
  const media = path.join(worktree, 'media');
  if (existsSync(media)) await symlink(media, path.join(overlay, 'media'), 'dir');
  return overlay;
}

function buildProbeRunner() {
  return String.raw`const path = require('node:path');
const Mocha = require(path.join(process.env.MFE_EXTENSION_PERF_NODE_MODULES, 'mocha'));

module.exports.run = async function run() {
  const mocha = new Mocha({ ui: 'tdd', timeout: 60000, color: false });
  mocha.addFile(process.env.MFE_EXTENSION_PERF_TEST_FILE);
  await new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) reject(new Error('Performance probe failed with ' + failures + ' failure(s)'));
      else resolve();
    });
  });
};
`;
}

function buildProbeTest() {
  return String.raw`const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');

const outputPath = process.env.MFE_EXTENSION_PERF_OUTPUT;
const expectedRoot = process.env.MFE_EXTENSION_PERF_EXPECTED_ROOT;
const timeoutMs = Number(process.env.MFE_EXTENSION_PERF_TIMEOUT_MS || 60000);

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

function replaceMethod(target, name, replacement) {
  const original = target[name];
  if (typeof original !== 'function') throw new Error('VS Code API method is unavailable: ' + name);
  let installed = false;
  try {
    target[name] = replacement;
    installed = target[name] === replacement;
  } catch {}
  if (!installed) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      writable: true,
      value: replacement
    });
  }
  return () => {
    try {
      target[name] = original;
    } catch {
      Object.defineProperty(target, name, { configurable: true, enumerable: true, writable: true, value: original });
    }
  };
}

function describeChildren(children) {
  return children.map(child => ({
    type: typeof child?.type === 'string' ? child.type : undefined,
    name: typeof child?.name === 'string' ? child.name : undefined,
    path: typeof child?.path === 'string' ? child.path : undefined
  }));
}

async function waitForStaticTree(provider, activationStartMs, state) {
  const deadline = performance.now() + timeoutMs;
  let attempts = 0;
  let lastChildren = [];
  while (performance.now() < deadline) {
    attempts++;
    if (provider && typeof provider.getChildren === 'function') {
      try {
        const children = await Promise.resolve(provider.getChildren());
        lastChildren = Array.isArray(children) ? children : [];
        if (lastChildren.some(child => child && child.path === expectedRoot)) {
          return {
            readyAtMs: performance.now() - activationStartMs,
            attempts,
            children: describeChildren(lastChildren)
          };
        }
      } catch (error) {
        state.lastProbeError = error instanceof Error ? error.message : String(error);
      }
    }
    await sleep(20);
  }
  throw new Error(
    'Timed out waiting for loaded root ' + expectedRoot + '; last children: ' + JSON.stringify(describeChildren(lastChildren))
  );
}

function getApplicationSnapshot(activationExports) {
  const application = activationExports && activationExports.application;
  if (!application || typeof application.getStore !== 'function') return undefined;
  const store = application.getStore();
  if (!store || typeof store.getSnapshot !== 'function') return undefined;
  return store.getSnapshot();
}

async function waitForCompleteData(activationExports, staticTree, activationStartMs, state) {
  const firstSnapshot = getApplicationSnapshot(activationExports);
  if (!firstSnapshot || typeof firstSnapshot.isManifestLoading !== 'boolean') {
    return { readyAtMs: staticTree.readyAtMs, source: 'static-tree-fallback' };
  }

  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const snapshot = getApplicationSnapshot(activationExports);
    if (snapshot && !snapshot.isLoading && !snapshot.isManifestLoading) {
      return { readyAtMs: performance.now() - activationStartMs, source: 'application-snapshot' };
    }
    await sleep(20);
  }
  state.lastProbeError = 'Timed out waiting for complete application data';
  throw new Error(state.lastProbeError);
}

suite('External VS Code performance probe', () => {
  test('measures activation, registration, static tree, and complete data', async function () {
    this.timeout(timeoutMs + 10000);
    const testStartedAtMs = performance.now();
    const state = {
      status: 'failed',
      providerRegisteredAtMs: undefined,
      treeViewCreatedAtMs: undefined,
      firstCommandRegisteredAtMs: undefined,
      refreshCommandRegisteredAtMs: undefined,
      lastProbeError: undefined
    };
    const cleanups = [];
    let provider;
    let extension;
    let activationStartMs;
    let activationEndMs;
    let activationExports;
    let staticTree;
    let completeData;

    try {
      const originalRegisterTreeDataProvider = vscode.window.registerTreeDataProvider;
      const originalCreateTreeView = vscode.window.createTreeView;
      const originalRegisterCommand = vscode.commands.registerCommand;
      cleanups.push(
        replaceMethod(vscode.window, 'registerTreeDataProvider', function registerTreeDataProvider(id, candidate) {
          if (id === 'moduleFederation') {
            provider = candidate;
            state.providerRegisteredAtMs = performance.now();
          }
          return originalRegisterTreeDataProvider.call(this, id, candidate);
        })
      );
      cleanups.push(
        replaceMethod(vscode.window, 'createTreeView', function createTreeView(id, options) {
          if (id === 'moduleFederation') {
            provider = options.treeDataProvider;
            state.treeViewCreatedAtMs = performance.now();
          }
          return originalCreateTreeView.call(this, id, options);
        })
      );
      cleanups.push(
        replaceMethod(vscode.commands, 'registerCommand', function registerCommand(command, callback, thisArg) {
          const now = performance.now();
          state.firstCommandRegisteredAtMs ??= now;
          if (command === 'moduleFederation.refresh') state.refreshCommandRegisteredAtMs = now;
          return originalRegisterCommand.call(this, command, callback, thisArg);
        })
      );

      extension = vscode.extensions.getExtension('acjr.mf-explorer');
      assert.ok(extension, 'Target extension must be available');
      assert.equal(extension.isActive, false, 'Target extension must be inactive before the manual probe');
      activationStartMs = performance.now();
      activationExports = await extension.activate();
      activationEndMs = performance.now();
      staticTree = await waitForStaticTree(provider, activationStartMs, state);
      completeData = await waitForCompleteData(activationExports, staticTree, activationStartMs, state);
      state.status = 'passed';
      await writeReport({
        schemaVersion: 1,
        status: state.status,
        activationMs: activationEndMs - activationStartMs,
        staticTreeMs: staticTree.readyAtMs,
        completeDataMs: completeData.readyAtMs,
        staticWaitMs: staticTree.readyAtMs - (activationEndMs - activationStartMs),
        completeWaitMs: completeData.readyAtMs - (activationEndMs - activationStartMs),
        completeDataSource: completeData.source,
        providerRegistrationMs:
          state.providerRegisteredAtMs === undefined ? undefined : state.providerRegisteredAtMs - activationStartMs,
        treeViewCreationMs:
          state.treeViewCreatedAtMs === undefined ? undefined : state.treeViewCreatedAtMs - activationStartMs,
        firstCommandRegistrationMs:
          state.firstCommandRegisteredAtMs === undefined ? undefined : state.firstCommandRegisteredAtMs - activationStartMs,
        refreshCommandRegistrationMs:
          state.refreshCommandRegisteredAtMs === undefined ? undefined : state.refreshCommandRegisteredAtMs - activationStartMs,
        loadPollAttempts: staticTree.attempts,
        loadedChildren: staticTree.children,
        extensionExportsType: typeof activationExports,
        probeMs: performance.now() - testStartedAtMs
      });
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      await writeReport({
        schemaVersion: 1,
        status: state.status,
        activationMs:
          activationStartMs === undefined || activationEndMs === undefined ? undefined : activationEndMs - activationStartMs,
        staticTreeMs: staticTree?.readyAtMs,
        completeDataMs: completeData?.readyAtMs,
        diagnostics: {
          error: message,
          lastProbeError: state.lastProbeError,
          providerCaptured: provider !== undefined
        }
      });
      throw error;
    } finally {
      for (const cleanup of cleanups.reverse()) cleanup();
    }
  });
});
`;
}

async function runOne({
  runTests,
  workspace,
  host,
  extensionPath,
  probeRunner,
  nodeModules,
  outputRoot,
  ref,
  sha,
  mode,
  runNumber,
  vscodePath,
  timeoutMs
}) {
  const safeRef = ref.replaceAll('/', '_');
  const runDirectory = path.join(outputRoot, 'runs', safeRef, mode, String(runNumber));
  const profileRoot = path.join(outputRoot, 'profiles', safeRef, mode);
  const profilePath = mode === 'cold' ? path.join(profileRoot, String(runNumber)) : profileRoot;
  const extensionsPath = path.join(profilePath, 'extensions');
  await mkdir(runDirectory, { recursive: true });
  await mkdir(profilePath, { recursive: true });
  const reportPath = path.join(runDirectory, 'probe.json');
  const runnerStarted = performance.now();
  await runTests({
    vscodeExecutablePath: vscodePath,
    extensionDevelopmentPath: extensionPath,
    extensionTestsPath: probeRunner,
    extensionTestsEnv: {
      NODE_PATH: nodeModules,
      MFE_EXTENSION_PERF_NODE_MODULES: nodeModules,
      MFE_EXTENSION_PERF_TEST_FILE: path.join(path.dirname(probeRunner), 'probe.test.cjs'),
      MFE_EXTENSION_PERF_OUTPUT: reportPath,
      MFE_EXTENSION_PERF_EXPECTED_ROOT: host,
      MFE_EXTENSION_PERF_TIMEOUT_MS: String(timeoutMs)
    },
    launchArgs: [
      workspace,
      `--user-data-dir=${path.join(profilePath, 'user-data')}`,
      `--extensions-dir=${extensionsPath}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes'
    ],
    version: vscodeVersion,
    reuseMachineInstall: false
  });
  const runnerMs = performance.now() - runnerStarted;
  const probe = JSON.parse(await readFile(reportPath, 'utf8'));
  probe.ref = ref;
  probe.sha = sha;
  probe.mode = mode;
  probe.run = runNumber;
  probe.runnerMs = runnerMs;
  if (probe.status !== 'passed') throw new Error(`Performance probe failed for ${ref} ${mode} run ${runNumber}`);
  return probe;
}

function summarize(values) {
  const finite = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return { count: 0 };
  const sorted = [...finite].sort((left, right) => left - right);
  const percentile = fraction =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return {
    count: finite.length,
    minMs: sorted[0],
    medianMs: percentile(0.5),
    averageMs: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1]
  };
}

function buildSummaries(results) {
  const groups = new Map();
  for (const result of results) {
    const key = JSON.stringify([result.ref, result.mode]);
    const group = groups.get(key) || [];
    group.push(result);
    groups.set(key, group);
  }
  const metrics = [
    'activationMs',
    'staticTreeMs',
    'completeDataMs',
    'staticWaitMs',
    'completeWaitMs',
    'providerRegistrationMs',
    'treeViewCreationMs',
    'firstCommandRegistrationMs',
    'refreshCommandRegistrationMs',
    'runnerMs'
  ];
  return [...groups.entries()].map(([key, runs]) => {
    const [ref, mode] = JSON.parse(key);
    return {
      ref,
      mode,
      runs: runs.length,
      metrics: Object.fromEntries(metrics.map(metric => [metric, summarize(runs.map(runResult => runResult[metric]))]))
    };
  });
}

function buildDeltas(summaries, baseRef, headRef, modes) {
  const deltas = [];
  for (const mode of modes) {
    const base = summaries.find(summary => summary.ref === baseRef && summary.mode === mode);
    const head = summaries.find(summary => summary.ref === headRef && summary.mode === mode);
    if (!base || !head) continue;
    for (const metric of ['activationMs', 'staticTreeMs', 'completeDataMs', 'runnerMs']) {
      const baseMedian = base.metrics[metric]?.medianMs;
      const headMedian = head.metrics[metric]?.medianMs;
      if (typeof baseMedian !== 'number' || typeof headMedian !== 'number') continue;
      const deltaMs = headMedian - baseMedian;
      deltas.push({
        mode,
        metric,
        baseMedianMs: baseMedian,
        headMedianMs: headMedian,
        deltaMs,
        percent: baseMedian === 0 ? undefined : (deltaMs / baseMedian) * 100
      });
    }
  }
  return deltas;
}

function formatMs(value) {
  return typeof value === 'number' ? `${value.toFixed(2)} ms` : 'n/a';
}

function buildMarkdown(report) {
  const lines = [
    '# Extension performance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Base: \`${report.base.ref}\` (${report.base.sha})`,
    `Head: \`${report.head.ref}\` (${report.head.sha})`,
    '',
    '| Ref | Mode | Activation (median / p95) | Static tree (median / p95) | Complete data (median / p95) | Runner (median / p95) |',
    '| --- | --- | ---: | ---: | ---: | ---: |'
  ];
  for (const summary of report.summaries) {
    lines.push(
      `| ${summary.ref} | ${summary.mode} | ${formatMs(summary.metrics.activationMs.medianMs)} / ${formatMs(summary.metrics.activationMs.p95Ms)} | ${formatMs(summary.metrics.staticTreeMs.medianMs)} / ${formatMs(summary.metrics.staticTreeMs.p95Ms)} | ${formatMs(summary.metrics.completeDataMs.medianMs)} / ${formatMs(summary.metrics.completeDataMs.p95Ms)} | ${formatMs(summary.metrics.runnerMs.medianMs)} / ${formatMs(summary.metrics.runnerMs.p95Ms)} |`
    );
  }
  lines.push(
    '',
    '## Deltas',
    '',
    '| Mode | Metric | Base median | Head median | Delta | Change |',
    '| --- | --- | ---: | ---: | ---: | ---: |'
  );
  for (const delta of report.deltas) {
    lines.push(
      `| ${delta.mode} | ${delta.metric} | ${formatMs(delta.baseMedianMs)} | ${formatMs(delta.headMedianMs)} | ${formatMs(delta.deltaMs)} | ${typeof delta.percent === 'number' ? `${delta.percent.toFixed(2)}%` : 'n/a'} |`
    );
  }
  lines.push(
    '',
    'Activation is measured from the explicit extension.activate() call until its promise resolves.',
    'Static tree is the first observation of the configured root through the actual tree provider.',
    'Complete data uses the application snapshot when available and falls back to the static tree for legacy refs.',
    'The benchmark runs clean detached worktrees and does not enable refactor-only performance instrumentation.'
  );
  return lines.join('\n') + '\n';
}

async function benchmarkRef({
  benchmarkRoot,
  fixture,
  probeRunner,
  nodeModules,
  outputRoot,
  ref,
  sha,
  vscodePath,
  modes,
  runs,
  runTests,
  timeoutMs
}) {
  const label = ref === 'master' ? 'base' : 'head';
  const worktree = await createWorktree(benchmarkRoot, sha, label);
  try {
    console.log(`\nPreparing ${ref} (${sha})`);
    const compileMs = await compile(worktree);
    const extensionPath = await createExtensionOverlay(worktree, benchmarkRoot, label);
    const results = [];
    for (const mode of modes) {
      for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
        console.log(`Running ${ref} ${mode} ${runNumber}/${runs}`);
        results.push(
          await runOne({
            runTests,
            workspace: fixture.workspace,
            host: fixture.host,
            extensionPath,
            probeRunner,
            nodeModules,
            outputRoot,
            ref,
            sha,
            mode,
            runNumber,
            vscodePath,
            timeoutMs
          })
        );
      }
    }
    return { ref, sha, compileMs, results };
  } finally {
    await removeWorktree(worktree);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (await runUnderVirtualDisplayIfNeeded()) return;

  const baseSha = await resolveRef(options.base);
  const headSha = await resolveRef(options.head);
  const nodeModules = path.join(repositoryRoot, 'node_modules');
  const benchmarkRoot = await mkdtemp(path.join(os.tmpdir(), 'mfe-extension-performance-'));
  const outputRoot = path.resolve(options.out);
  await mkdir(outputRoot, { recursive: true });
  const fixture = await createFixture(benchmarkRoot);
  const probeDirectory = path.join(benchmarkRoot, 'probe');
  await mkdir(probeDirectory, { recursive: true });
  const probeRunner = path.join(probeDirectory, 'probe-runner.cjs');
  await writeFile(probeRunner, buildProbeRunner(), 'utf8');
  await writeFile(path.join(probeDirectory, 'probe.test.cjs'), buildProbeTest(), 'utf8');

  const platformDirectory = process.platform === 'linux' ? 'linux-x64' : process.platform;
  const executableName = process.platform === 'win32' ? 'Code.exe' : 'code';
  const vscodePath =
    options.vscode ||
    path.join(repositoryRoot, '.vscode-test', `vscode-${platformDirectory}-${vscodeVersion}`, executableName);
  if (!existsSync(vscodePath)) throw new Error(`VS Code executable not found: ${vscodePath}`);

  const requireFromRepository = createRequire(path.join(repositoryRoot, 'package.json'));
  const { runTests } = requireFromRepository('@vscode/test-electron');
  try {
    const base = await benchmarkRef({
      benchmarkRoot,
      fixture,
      probeRunner,
      nodeModules,
      outputRoot,
      ref: options.base,
      sha: baseSha,
      vscodePath,
      modes: options.modes,
      runs: options.runs,
      runTests,
      timeoutMs: defaultTimeoutMs
    });
    const head = await benchmarkRef({
      benchmarkRoot,
      fixture,
      probeRunner,
      nodeModules,
      outputRoot,
      ref: options.head,
      sha: headSha,
      vscodePath,
      modes: options.modes,
      runs: options.runs,
      runTests,
      timeoutMs: defaultTimeoutMs
    });
    const summaries = buildSummaries([...base.results, ...head.results]);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      repositoryRoot,
      vscodeVersion,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      base: { ref: base.ref, sha: base.sha, compileMs: base.compileMs },
      head: { ref: head.ref, sha: head.sha, compileMs: head.compileMs },
      summaries,
      deltas: buildDeltas(summaries, options.base, options.head, options.modes),
      runs: [...base.results, ...head.results]
    };
    await writeFile(
      path.join(outputRoot, 'extension-performance.json'),
      JSON.stringify(report, null, 2) + '\n',
      'utf8'
    );
    await writeFile(path.join(outputRoot, 'extension-performance.md'), buildMarkdown(report), 'utf8');
    console.log(`\nReports written to ${outputRoot}`);
  } finally {
    await rm(benchmarkRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

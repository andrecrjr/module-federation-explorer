#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatMilliseconds, latestMeasurement, parsePerformanceSnapshot, summarize } from './performance-metrics.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const performanceWorkspaceRelativePath = 'src/test/fixtures/extension-workspace';
const performanceTestRelativePath = 'src/test/integration/app/extensionPerformance.integrationTest.ts';
const vscodeVersion = '1.135.0';

function help() {
  console.log(`Usage: node scripts/extension-performance.mjs [options]

Options:
  --base <ref>       Baseline Git ref (default: master)
  --head <ref>       Candidate Git ref (default: HEAD)
  --runs <number>    Runs per ref and mode (default: 5)
  --mode <modes>     Comma-separated modes: cold,warm (default: cold)
  --out <directory>  Report directory (default: reports/refactor)
  --help             Show this help
`);
}

function parseOptions(argv) {
  const options = {
    base: 'master',
    head: 'HEAD',
    runs: 5,
    modes: ['cold'],
    out: path.join(repositoryRoot, 'reports/refactor')
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      help();
      process.exit(0);
    }
    if (!['--base', '--head', '--runs', '--mode', '--out'].includes(argument)) {
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

async function resolveRef(ref) {
  return capture('git', ['rev-parse', '--verify', `${ref}^{commit}`], repositoryRoot);
}

async function createWorktree(ref, label) {
  const parent = await mkdtemp(path.join(os.tmpdir(), `mfe-extension-performance-${label}-`));
  const worktree = path.join(parent, 'repo');
  await run('git', ['worktree', 'add', '--detach', worktree, ref], repositoryRoot, process.env);
  const nodeModules = path.join(repositoryRoot, 'node_modules');
  if (!existsSync(nodeModules)) throw new Error('node_modules is required to run the extension benchmark');
  await symlink(nodeModules, path.join(worktree, 'node_modules'), 'dir');
  return { parent, worktree };
}

async function removeWorktree(entry) {
  try {
    await run('git', ['worktree', 'remove', '--force', entry.worktree], repositoryRoot, process.env);
  } finally {
    await rm(entry.parent, { recursive: true, force: true });
  }
}

async function copyBenchmarkSupport(worktree) {
  const testPath = path.join(worktree, performanceTestRelativePath);
  await mkdir(path.dirname(testPath), { recursive: true });
  await copyFile(path.join(repositoryRoot, performanceTestRelativePath), testPath);

  await copyFile(path.join(repositoryRoot, '.vscode-test.mjs'), path.join(worktree, '.vscode-test.mjs'));

  const manifestPath = path.join(worktree, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.activationEvents = [];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function prepareWorkspace(worktree) {
  const workspace = path.join(worktree, performanceWorkspaceRelativePath);
  const rootConfigDirectory = path.join(workspace, '.vscode');
  await mkdir(rootConfigDirectory, { recursive: true });
  await writeFile(
    path.join(rootConfigDirectory, 'mf-explorer.roots.json'),
    JSON.stringify({ roots: [path.join(workspace, 'host')] }, null, 2),
    'utf8'
  );
  return workspace;
}

async function compile(worktree) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await run(npm, ['run', 'compile'], worktree, process.env);
  await run(npm, ['run', 'compile:test'], worktree, process.env);
}

function findVscodeExecutable() {
  const executableName = process.platform === 'win32' ? 'Code.exe' : 'code';
  const platformDirectory = process.platform === 'linux' ? 'linux-x64' : process.platform;
  const candidate = path.join(
    repositoryRoot,
    '.vscode-test',
    `vscode-${platformDirectory}-${vscodeVersion}`,
    executableName
  );
  return existsSync(candidate) ? candidate : undefined;
}

async function runPerformanceTest(worktree, mode, runNumber, runRoot) {
  const outputPath = path.join(runRoot, `${mode}-${runNumber}.json`);
  const userDataDirectory =
    mode === 'cold' ? path.join(runRoot, `${mode}-${runNumber}-user-data`) : path.join(runRoot, `${mode}-user-data`);
  const extensionsDirectory =
    mode === 'cold' ? path.join(runRoot, `${mode}-${runNumber}-extensions`) : path.join(runRoot, `${mode}-extensions`);
  await rm(outputPath, { force: true });

  const vscodeExecutablePath = findVscodeExecutable();
  const env = {
    ...process.env,
    ELECTRON_OZONE_PLATFORM_HINT: process.platform === 'linux' ? 'x11' : process.env.ELECTRON_OZONE_PLATFORM_HINT,
    WAYLAND_DISPLAY: process.platform === 'linux' ? '' : process.env.WAYLAND_DISPLAY,
    MF_EXPLORER_PERF_OUTPUT: outputPath,
    MF_EXPLORER_PERF_USER_DATA_DIR: userDataDirectory,
    MF_EXPLORER_PERF_EXTENSIONS_DIR: extensionsDirectory,
    ...(vscodeExecutablePath ? { MF_EXPLORER_PERF_VSCODE_PATH: vscodeExecutablePath } : {})
  };
  const testCli = path.join(worktree, 'node_modules', '.bin', 'vscode-test');
  const useVirtualDisplay = process.platform === 'linux' && existsSync('/usr/bin/xvfb-run');
  const command = useVirtualDisplay ? 'xvfb-run' : testCli;
  const args = useVirtualDisplay
    ? ['-a', testCli, '--label', 'extension-performance']
    : ['--label', 'extension-performance'];
  const started = performance.now();
  await run(command, args, worktree, env);
  const runnerDurationMs = performance.now() - started;

  const raw = JSON.parse(await readFile(outputPath, 'utf8'));
  const snapshot = parsePerformanceSnapshot(raw);
  return {
    run: runNumber,
    mode,
    activationMs: latestMeasurement(snapshot, 'activation'),
    initialLoadMs: latestMeasurement(snapshot, 'initialLoad'),
    initializeMs: latestMeasurement(snapshot, 'initialize'),
    runnerDurationMs,
    measurements: snapshot.measurements
  };
}

async function benchmarkRef(ref, label, options) {
  const sha = await resolveRef(ref);
  const worktreeEntry = await createWorktree(sha, label);
  const runRoot = await mkdtemp(path.join(os.tmpdir(), `mfe-extension-performance-runs-${label}-`));
  try {
    await copyBenchmarkSupport(worktreeEntry.worktree);
    await prepareWorkspace(worktreeEntry.worktree);
    await compile(worktreeEntry.worktree);
    const scenarios = [];
    for (const mode of options.modes) {
      const runs = [];
      for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
        runs.push(await runPerformanceTest(worktreeEntry.worktree, mode, runNumber, runRoot));
      }
      scenarios.push({
        ref,
        sha,
        mode,
        runs,
        summary: {
          activation: summarize(runs.map(runResult => runResult.activationMs)),
          initialLoad: summarize(runs.map(runResult => runResult.initialLoadMs)),
          initialize: summarize(runs.map(runResult => runResult.initializeMs)),
          runner: summarize(runs.map(runResult => runResult.runnerDurationMs))
        }
      });
    }
    return { ref, sha, scenarios };
  } finally {
    await rm(runRoot, { recursive: true, force: true });
    await removeWorktree(worktreeEntry);
  }
}

function buildMarkdown(report) {
  const lines = [
    '# Extension performance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Ref | Mode | Activation median | Activation p95 | Initial load median | Initial load p95 | Runner median |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.ref} | ${scenario.mode} | ${formatMilliseconds(scenario.summary.activation.medianMs)} | ${formatMilliseconds(scenario.summary.activation.p95Ms)} | ${formatMilliseconds(scenario.summary.initialLoad.medianMs)} | ${formatMilliseconds(scenario.summary.initialLoad.p95Ms)} | ${formatMilliseconds(scenario.summary.runner.medianMs)} |`
    );
  }
  lines.push(
    '',
    'The benchmark disables manifest activation events in its temporary worktree and activates the extension explicitly so both refs are measured from the same boundary.'
  );
  return lines.join('\n') + '\n';
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });
  const base = await benchmarkRef(options.base, 'base', options);
  const head = await benchmarkRef(options.head, 'head', options);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    base: { ref: base.ref, sha: base.sha },
    head: { ref: head.ref, sha: head.sha },
    scenarios: [...base.scenarios, ...head.scenarios],
    notes: [
      'Measurements describe extension activation and initial configuration loading only.',
      'Graph generation metrics are intentionally excluded.',
      'Each ref is benchmarked in a clean detached worktree with a fresh build.'
    ]
  };
  await writeFile(path.join(options.out, 'extension-performance.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await writeFile(path.join(options.out, 'extension-performance.md'), buildMarkdown(report), 'utf8');
  console.log(`Reports written to ${options.out}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

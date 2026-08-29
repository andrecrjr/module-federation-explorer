import { spawn } from 'node:child_process';

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmArguments = process.argv.slice(2);
const commandArguments = npmArguments.length > 0 ? npmArguments : ['test'];
const useVirtualDisplay = process.platform === 'linux' && process.env.MF_EXPLORER_USE_SYSTEM_DISPLAY !== '1';
const environment = { ...process.env };

if (process.platform === 'linux') {
  environment.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
  environment.WAYLAND_DISPLAY = '';
  environment.XDG_SESSION_TYPE = 'x11';
}

const command = useVirtualDisplay ? 'xvfb-run' : npmExecutable;
const args = useVirtualDisplay ? ['-a', npmExecutable, ...commandArguments] : commandArguments;

const child = spawn(command, args, {
  env: environment,
  stdio: 'inherit'
});

child.once('error', error => {
  console.error(`Unable to start ${command}: ${error.message}`);
  process.exitCode = 1;
});

child.once('close', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});

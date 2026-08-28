/** @deprecated Import the VS Code runtime service from infrastructure/vscode instead. */
export {
  TerminalManager,
  type RunningRemote,
  type TerminalManagerDependencies
} from './infrastructure/vscode/terminalManager';
export type {
  TerminalCleanupResult,
  TerminalLike
} from './app/ports';

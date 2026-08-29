import * as vscode from 'vscode';
import { ExplorerApplication } from './explorerApplication';
import { detectModuleFederationProjects, showOnboardingPage } from '../features/onboarding';

const DEFAULT_ONBOARDING_DELAY_MS = 1500;
const DEFAULT_TERMINAL_CLEANUP_INTERVAL_MS = 10000;

export function scheduleOnboarding(
  context: vscode.ExtensionContext,
  application: ExplorerApplication,
  delayMs = DEFAULT_ONBOARDING_DELAY_MS
): void {
  const timer = setTimeout(() => {
    void runOnboarding(context, application);
  }, delayMs);

  context.subscriptions.push(new vscode.Disposable(() => clearTimeout(timer)));
}

export function registerTerminalLifecycle(
  context: vscode.ExtensionContext,
  application: ExplorerApplication,
  cleanupIntervalMs = DEFAULT_TERMINAL_CLEANUP_INTERVAL_MS
): void {
  application.clearAllRunningApps();

  const terminalDisposalListener = vscode.window.onDidCloseTerminal(terminal => {
    application.handleTerminalClosed(terminal);
  });
  const cleanupTimer = setInterval(() => application.cleanupDisposedTerminals(), cleanupIntervalMs);

  context.subscriptions.push(terminalDisposalListener, new vscode.Disposable(() => clearInterval(cleanupTimer)));
}

async function runOnboarding(context: vscode.ExtensionContext, application: ExplorerApplication): Promise<void> {
  try {
    if (await application.hasConfiguredRoots()) return;

    application.log('Running auto-detection for Module Federation projects');
    const detectedProjects = await detectModuleFederationProjects();
    if (detectedProjects.length > 0) {
      application.log(`Detected ${detectedProjects.length} MF projects. Showing onboarding UI.`);
      showOnboardingPage(context, application, detectedProjects);
    } else {
      application.log('No MF projects detected automatically.');
    }
  } catch (error) {
    application.logError('Background onboarding scan failed', error);
  }
}

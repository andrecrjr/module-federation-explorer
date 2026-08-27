import * as vscode from 'vscode';
import { UnifiedModuleFederationProvider } from './unifiedTreeProvider';
import { detectModuleFederationProjects } from './workspaceScanner';
import { showOnboardingPage } from './onboarding';

const DEFAULT_ONBOARDING_DELAY_MS = 1500;
const DEFAULT_TERMINAL_CLEANUP_INTERVAL_MS = 10000;

export function scheduleOnboarding(
  context: vscode.ExtensionContext,
  provider: UnifiedModuleFederationProvider,
  delayMs = DEFAULT_ONBOARDING_DELAY_MS
): void {
  const timer = setTimeout(() => {
    void runOnboarding(context, provider);
  }, delayMs);

  context.subscriptions.push({
    dispose: () => clearTimeout(timer)
  });
}

export function registerTerminalLifecycle(
  context: vscode.ExtensionContext,
  provider: UnifiedModuleFederationProvider,
  cleanupIntervalMs = DEFAULT_TERMINAL_CLEANUP_INTERVAL_MS
): void {
  provider.clearAllRunningApps();

  const terminalDisposalListener = vscode.window.onDidCloseTerminal(terminal => {
    provider.log(`[Event] Terminal disposal event fired for: ${terminal.name}`);
    provider.handleTerminalClosed(terminal);
  });

  const cleanupTimer = setInterval(() => {
    provider.cleanupDisposedTerminals();
  }, cleanupIntervalMs);

  context.subscriptions.push(terminalDisposalListener, {
    dispose: () => clearInterval(cleanupTimer)
  });
}

async function runOnboarding(
  context: vscode.ExtensionContext,
  provider: UnifiedModuleFederationProvider
): Promise<void> {
  try {
    if (await provider.hasConfiguredRoots()) return;

    provider.log('Running auto-detection for Module Federation projects');
    const detectedProjects = await detectModuleFederationProjects();

    if (detectedProjects.length > 0) {
      provider.log(`Detected ${detectedProjects.length} MF projects. Showing onboarding UI.`);
      showOnboardingPage(context, provider, detectedProjects);
    } else {
      provider.log('No MF projects detected automatically.');
    }
  } catch (error) {
    provider.logError('Background onboarding scan failed', error);
  }
}

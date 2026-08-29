import * as vscode from 'vscode';
import type { ExplorerApplication } from '../../app/explorerApplication';
import { isOnboardingMessage, type OnboardingMessage } from './messages';
import { getOnboardingHtml } from './template';
import type { DetectedProject, OnboardingSelection } from './types';

export class OnboardingController {
  private readonly panel: vscode.WebviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly application: ExplorerApplication,
    private readonly detectedProjects: readonly DetectedProject[]
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'moduleFederationOnboarding',
      'Module Federation Setup',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );
  }

  show(): void {
    this.context.subscriptions.push(this.panel);
    this.panel.webview.onDidReceiveMessage(
      message => {
        void this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );
    void this.render();
  }

  private async render(): Promise<void> {
    let existingRoots: string[] = [];
    try {
      const config = await this.application.loadRootConfig();
      existingRoots = config?.roots ? [...config.roots] : [];
    } catch (error) {
      this.application.log(`Failed to load existing roots for onboarding: ${String(error)}`);
    }

    this.panel.webview.html = getOnboardingHtml(this.context, this.panel.webview, this.detectedProjects, existingRoots);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isOnboardingMessage(message)) return;

    try {
      switch (message.command) {
        case 'browseHostFolder':
          await this.browseHostFolder(message.idx);
          return;
        case 'addSelectedFolders':
          await this.addSelectedFolders(message);
          return;
        case 'skipOnboarding':
          this.panel.dispose();
          return;
      }
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to process onboarding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async browseHostFolder(idx: number): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Host Folder'
    });
    const folder = uris?.[0]?.fsPath;
    if (folder) this.panel.webview.postMessage({ command: 'hostFolderSelected', idx, folder });
  }

  private async addSelectedFolders(
    message: Extract<OnboardingMessage, { command: 'addSelectedFolders' }>
  ): Promise<void> {
    if (message.items.length === 0) {
      void vscode.window.showWarningMessage('No projects selected to add.');
      return;
    }

    const selections: OnboardingSelection[] = message.items.map(item => ({
      path: item.path,
      role: item.role,
      hostFolder: item.hostFolder || undefined
    }));
    const result = await this.application.completeOnboarding(selections, this.detectedProjects);
    if (result.configuredProjects === 0) {
      void vscode.window.showWarningMessage('No valid projects selected to add.');
      return;
    }
    if (result.skippedProjects > 0) {
      void vscode.window.showWarningMessage(
        `Skipped ${result.skippedProjects} project(s) without a valid host selection.`
      );
    }

    await vscode.commands.executeCommand('moduleFederation.reveal');
    void vscode.window.showInformationMessage(
      `Successfully configured ${result.configuredProjects} Module Federation project(s)!`
    );
    this.panel.dispose();
  }
}

export function showOnboardingPage(
  context: vscode.ExtensionContext,
  application: ExplorerApplication,
  detectedProjects: readonly DetectedProject[]
): OnboardingController {
  const controller = new OnboardingController(context, application, detectedProjects);
  controller.show();
  return controller;
}

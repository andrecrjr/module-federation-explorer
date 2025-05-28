import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Enhanced dialog utilities for better user experience
 */
export class DialogUtils {
  
  /**
   * Show an enhanced information message with better formatting and icons
   */
  static async showInfo(
    message: string, 
    options?: {
      modal?: boolean;
      detail?: string;
      actions?: Array<{ title: string; isCloseAffordance?: boolean; }>;
    }
  ): Promise<string | undefined> {
    const formattedMessage = `ℹ️ ${message}`;
    const messageOptions: vscode.MessageOptions = {
      modal: options?.modal || false,
      detail: options?.detail
    };
    
    const actionTitles = options?.actions?.map(a => a.title) || [];
    return await vscode.window.showInformationMessage(formattedMessage, messageOptions, ...actionTitles);
  }

  /**
   * Show an enhanced warning message with better formatting and icons
   */
  static async showWarning(
    message: string,
    options?: {
      modal?: boolean;
      detail?: string;
      actions?: Array<{ title: string; isCloseAffordance?: boolean; }>;
    }
  ): Promise<string | undefined> {
    const formattedMessage = `⚠️ ${message}`;
    const messageOptions: vscode.MessageOptions = {
      modal: options?.modal || false,
      detail: options?.detail
    };
    
    const actionTitles = options?.actions?.map(a => a.title) || [];
    return await vscode.window.showWarningMessage(formattedMessage, messageOptions, ...actionTitles);
  }

  /**
   * Show an enhanced error message with better formatting and icons
   */
  static async showError(
    message: string,
    options?: {
      modal?: boolean;
      detail?: string;
      actions?: Array<{ title: string; isCloseAffordance?: boolean; }>;
    }
  ): Promise<string | undefined> {
    const formattedMessage = `❌ ${message}`;
    const messageOptions: vscode.MessageOptions = {
      modal: options?.modal || false,
      detail: options?.detail
    };
    
    const actionTitles = options?.actions?.map(a => a.title) || [];
    return await vscode.window.showErrorMessage(formattedMessage, messageOptions, ...actionTitles);
  }

  /**
   * Show an enhanced input box with better validation and formatting
   */
  static async showInput(options: {
    title: string;
    prompt: string;
    placeholder?: string;
    value?: string;
    validateInput?: (value: string) => string | undefined;
    ignoreFocusOut?: boolean;
  }): Promise<string | undefined> {
    return await vscode.window.showInputBox({
      title: `📝 ${options.title}`,
      prompt: options.prompt,
      placeHolder: options.placeholder,
      value: options.value,
      validateInput: options.validateInput,
      ignoreFocusOut: options.ignoreFocusOut ?? true
    });
  }

  /**
   * Show an enhanced quick pick with better formatting and icons
   */
  static async showQuickPick<T extends vscode.QuickPickItem>(
    items: T[],
    options: {
      title: string;
      placeholder: string;
      canPickMany?: boolean;
      ignoreFocusOut?: boolean;
      matchOnDescription?: boolean;
      matchOnDetail?: boolean;
    }
  ): Promise<T | T[] | undefined> {
    return await vscode.window.showQuickPick(items, {
      title: `🔍 ${options.title}`,
      placeHolder: options.placeholder,
      canPickMany: options.canPickMany,
      ignoreFocusOut: options.ignoreFocusOut ?? true,
      matchOnDescription: options.matchOnDescription ?? true,
      matchOnDetail: options.matchOnDetail ?? true
    });
  }

  /**
   * Show an enhanced folder picker with better formatting and validation
   */
  static async showFolderPicker(options: {
    title: string;
    openLabel?: string;
    defaultUri?: vscode.Uri;
    validateFolder?: (folderPath: string) => Promise<{ valid: boolean; message?: string; }>;
  }): Promise<string | undefined> {
    while (true) {
      const selectedFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: options.openLabel || 'Select Folder',
        title: `📁 ${options.title}`,
        defaultUri: options.defaultUri
      });

      if (!selectedFolder || selectedFolder.length === 0) {
        return undefined;
      }

      const folderPath = selectedFolder[0].fsPath;

      // Validate folder if validator is provided
      if (options.validateFolder) {
        const validation = await options.validateFolder(folderPath);
        if (!validation.valid) {
          const retry = await this.showWarning(
            validation.message || 'Invalid folder selected',
            {
              modal: true,
              actions: [
                { title: 'Try Again' },
                { title: 'Cancel', isCloseAffordance: true }
              ]
            }
          );
          
          if (retry !== 'Try Again') {
            return undefined;
          }
          continue;
        }
      }

      return folderPath;
    }
  }

  /**
   * Show a confirmation dialog with enhanced formatting
   */
  static async showConfirmation(
    message: string,
    options?: {
      detail?: string;
      confirmText?: string;
      cancelText?: string;
      destructive?: boolean;
    }
  ): Promise<boolean> {
    const icon = options?.destructive ? '🗑️' : '❓';
    const confirmText = options?.confirmText || 'Yes';
    const cancelText = options?.cancelText || 'Cancel';
    
    const result = await vscode.window.showWarningMessage(
      `${icon} ${message}`,
      { 
        modal: true,
        detail: options?.detail
      },
      confirmText,
      cancelText
    );
    
    return result === confirmText;
  }

  /**
   * Show a progress dialog for long-running operations
   */
  static async withProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `⏳ ${title}`,
        cancellable: false
      },
      task
    );
  }

  /**
   * Show a multi-step wizard dialog
   */
  static async showWizard<T>(steps: Array<{
    title: string;
    execute: () => Promise<T | undefined>;
  }>): Promise<T | undefined> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepTitle = `${step.title} (${i + 1}/${steps.length})`;
      
      try {
        const result = await this.withProgress(stepTitle, async () => {
          return await step.execute();
        });
        
        if (result === undefined) {
          // User cancelled this step
          return undefined;
        }
        
        // If this is the last step, return the result
        if (i === steps.length - 1) {
          return result;
        }
      } catch (error) {
        await this.showError(
          `Failed at step: ${step.title}`,
          {
            detail: error instanceof Error ? error.message : String(error),
            actions: [{ title: 'OK' }]
          }
        );
        return undefined;
      }
    }
    
    return undefined;
  }

  /**
   * Show a command configuration dialog with package manager detection
   */
  static async showCommandConfig(options: {
    title: string;
    commandType: 'build' | 'start' | 'dev' | 'preview';
    currentCommand?: string;
    packageManager?: string;
    projectPath?: string;
    configType?: string;
  }): Promise<string | undefined> {
    // Detect package manager if not provided
    let packageManager = options.packageManager;
    if (!packageManager && options.projectPath) {
      packageManager = await this.detectPackageManager(options.projectPath);
    }
    packageManager = packageManager || 'npm';

    // Generate default command based on type and package manager
    const defaultCommands = {
      build: `${packageManager} run build`,
      start: `${packageManager} run preview`,
      dev: `${packageManager} run ${options.configType === 'vite' ? 'dev' : 'start'}`,
      preview: `${packageManager} run ${options.configType === 'vite' ? 'preview' : 'serve'}`
    };

    const defaultCommand = defaultCommands[options.commandType];
    const examples = {
      build: `${packageManager} run build, ${packageManager} run build:prod`,
      start: `${packageManager} run start, ${packageManager} start`,
      dev: `${packageManager} run dev, ${packageManager} run start:dev`,
      preview: `${packageManager} run preview, npx serve dist, ${packageManager} run serve`
    };

    return await this.showInput({
      title: options.title,
      prompt: `Enter the ${options.commandType} command`,
      placeholder: `Example: ${examples[options.commandType]}`,
      value: options.currentCommand || defaultCommand,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'Command cannot be empty';
        }
        return undefined;
      }
    });
  }

  /**
   * Detect package manager in a project directory
   */
  private static async detectPackageManager(projectPath: string): Promise<string> {
    const fs = require('fs');
    
    try {
      if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
        return 'pnpm';
      }
      if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
        return 'yarn';
      }
      if (fs.existsSync(path.join(projectPath, 'package-lock.json'))) {
        return 'npm';
      }
    } catch {
      // Ignore errors and fall back to npm
    }
    
    return 'npm';
  }

  /**
   * Show a success message with celebration
   */
  static async showSuccess(message: string, detail?: string): Promise<void> {
    await this.showInfo(`🎉 ${message}`, { detail });
  }

  /**
   * Show a setup guide dialog
   */
  static async showSetupGuide(options: {
    title: string;
    steps: Array<{
      title: string;
      description: string;
      action?: () => Promise<void>;
    }>;
  }): Promise<void> {
    const stepItems = options.steps.map((step, index) => ({
      label: `${index + 1}. ${step.title}`,
      description: step.description,
      step: step
    }));

    const selectedStep = await this.showQuickPick(stepItems, {
      title: options.title,
      placeholder: 'Select a step to execute or learn more about'
    });

    if (selectedStep && !Array.isArray(selectedStep) && selectedStep.step.action) {
      try {
        await selectedStep.step.action();
      } catch (error) {
        await this.showError(
          `Failed to execute step: ${selectedStep.step.title}`,
          {
            detail: error instanceof Error ? error.message : String(error)
          }
        );
      }
    }
  }
} 
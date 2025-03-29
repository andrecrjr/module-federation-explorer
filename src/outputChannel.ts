import * as vscode from 'vscode';

// Singleton output channel for the extension
export const outputChannel = vscode.window.createOutputChannel('Module Federation Explorer');

// Helper functions for logging
export function log(message: string): void {
  outputChannel.appendLine(message);
}

export function show(): void {
  outputChannel.show();
}

export function clear(): void {
  outputChannel.clear();
} 
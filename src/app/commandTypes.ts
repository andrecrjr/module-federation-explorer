import * as vscode from 'vscode';

export type CommandHandler = (...args: unknown[]) => unknown;
export type CommandRegistrar = (command: string, handler: CommandHandler) => vscode.Disposable;

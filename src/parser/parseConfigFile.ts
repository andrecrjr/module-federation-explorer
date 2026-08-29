import * as path from 'path';
import * as fs from 'fs/promises';
import { parse } from '@typescript-eslint/parser';
import type { AstNode } from './astUtils';

export interface ParseDiagnostic {
  filePath: string;
  message: string;
  severity: 'error' | 'warning';
  line?: number;
  column?: number;
}

export class ConfigParseError extends Error {
  constructor(
    public readonly diagnostics: readonly ParseDiagnostic[],
    cause?: unknown
  ) {
    super(diagnostics.map(diagnostic => diagnostic.message).join('; '));
    this.name = 'ConfigParseError';
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export type ConfigExtractor<T> = (ast: AstNode, workspaceRoot: string) => T | Promise<T>;

function diagnosticFromError(filePath: string, error: unknown): ParseDiagnostic {
  const candidate = error as {
    message?: unknown;
    lineNumber?: unknown;
    column?: unknown;
    loc?: { line?: unknown; column?: unknown };
  };
  const message = typeof candidate.message === 'string' ? candidate.message : String(error);
  const line =
    typeof candidate.lineNumber === 'number'
      ? candidate.lineNumber
      : typeof candidate.loc?.line === 'number'
        ? candidate.loc.line
        : undefined;
  const column =
    typeof candidate.column === 'number'
      ? candidate.column
      : typeof candidate.loc?.column === 'number'
        ? candidate.loc.column
        : undefined;
  return { filePath, message, severity: 'error', line, column };
}

export async function parseConfigText<T>(content: string, filePath: string, extractor: ConfigExtractor<T>): Promise<T> {
  let ast: AstNode;
  try {
    ast = parse(content, {
      sourceType: 'module',
      ecmaVersion: 'latest',
      loc: true,
      range: true
    }) as unknown as AstNode;
  } catch (error) {
    throw new ConfigParseError([diagnosticFromError(filePath, error)], error);
  }

  try {
    return await extractor(ast, path.dirname(filePath));
  } catch (error) {
    if (error instanceof ConfigParseError) throw error;
    throw new ConfigParseError([diagnosticFromError(filePath, error)], error);
  }
}

export async function parseConfigFile<T>(filePath: string, extractor: ConfigExtractor<T>): Promise<T> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new ConfigParseError([diagnosticFromError(filePath, error)], error);
  }
  return parseConfigText(content, filePath, extractor);
}

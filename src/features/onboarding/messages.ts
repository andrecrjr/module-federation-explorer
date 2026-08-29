import type { OnboardingProjectRole } from './types';

export type OnboardingMessage =
  | { command: 'browseHostFolder'; idx: number }
  | { command: 'addSelectedFolders'; items: OnboardingSelectionMessage[] }
  | { command: 'skipOnboarding' };

export interface OnboardingSelectionMessage {
  path: string;
  role: OnboardingProjectRole;
  hostFolder: string | null;
}

export function isOnboardingMessage(message: unknown): message is OnboardingMessage {
  if (!isRecord(message) || typeof message.command !== 'string') return false;

  switch (message.command) {
    case 'browseHostFolder':
      return isNonNegativeInteger(message.idx);
    case 'addSelectedFolders':
      return Array.isArray(message.items) && message.items.every(isOnboardingSelection);
    case 'skipOnboarding':
      return true;
    default:
      return false;
  }
}

function isOnboardingSelection(value: unknown): value is OnboardingSelectionMessage {
  if (!isRecord(value) || typeof value.path !== 'string' || (value.role !== 'host' && value.role !== 'remote')) {
    return false;
  }

  return value.hostFolder === null || typeof value.hostFolder === 'string';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

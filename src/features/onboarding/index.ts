export { OnboardingController, showOnboardingPage } from './controller';
export { detectModuleFederationProjects } from './workspaceScanner';
export { isOnboardingMessage } from './messages';
export type { OnboardingMessage, OnboardingSelectionMessage } from './messages';
export type {
  DetectedProject,
  DetectedRemoteProject,
  OnboardingConfigurationResult,
  OnboardingProjectRole,
  OnboardingSelection
} from './types';

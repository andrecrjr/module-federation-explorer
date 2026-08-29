import type { DialogService, ExternalLinkPort, FeedbackPort, Logger, StoragePort, SuccessEvent } from '../../app/ports';

export const FEEDBACK_URL = 'https://acjr.notion.site/202b5e58148c8017ba2ad355fc377e4b?pvs=105';
export const MARKETPLACE_REVIEW_URL =
  'https://marketplace.visualstudio.com/items?itemName=acjr.mf-explorer&ssr=false#review-details';

const RATING_STATE_KEY = 'ratingPrompt.state';
const INSTALL_AGE_DAYS_THRESHOLD = 7;
const SUCCESS_COUNT_THRESHOLD = 5;
const PROMPT_COOLDOWN_DAYS = 20;

export interface RatingState {
  firstSeenAt: number;
  successCount: number;
  hasRated: boolean;
  neverAskAgain: boolean;
  lastPromptAt?: number;
  snoozeUntil?: number;
}

export interface FeedbackWorkflowDependencies {
  storage: StoragePort;
  dialogs: DialogService;
  externalLinks: ExternalLinkPort;
  logger: Logger;
  now?: () => number;
}

const DEFAULT_RATING_STATE: RatingState = {
  firstSeenAt: 0,
  successCount: 0,
  hasRated: false,
  neverAskAgain: false
};

export class FeedbackWorkflow implements FeedbackPort {
  private readonly now: () => number;

  constructor(private readonly dependencies: FeedbackWorkflowDependencies) {
    this.now = dependencies.now || Date.now;
  }

  async initialize(): Promise<void> {
    const state = this.getRatingState();
    if (state.firstSeenAt > 0) return;
    await this.saveRatingState({ ...state, firstSeenAt: this.now() });
  }

  async trackSuccess(_event: SuccessEvent): Promise<void> {
    try {
      const state = this.getRatingState();
      if (state.hasRated || state.neverAskAgain) return;

      const updatedState = { ...state, successCount: state.successCount + 1 };
      await this.saveRatingState(updatedState);
      await this.maybePromptForRating(updatedState);
    } catch (error) {
      this.dependencies.logger.logError('[Module Federation] Failed to track rating prompt state', error);
    }
  }

  async openMarketplaceReview(): Promise<void> {
    await this.dependencies.externalLinks.openExternal(MARKETPLACE_REVIEW_URL);
    await this.saveRatingState({
      ...this.getRatingState(),
      hasRated: true,
      lastPromptAt: this.now(),
      snoozeUntil: undefined
    });
  }

  async openFeedback(): Promise<void> {
    await this.dependencies.externalLinks.openExternal(FEEDBACK_URL);
  }

  private getRatingState(): RatingState {
    const stored = this.dependencies.storage.get<unknown>(RATING_STATE_KEY);
    return isRatingState(stored) ? stored : { ...DEFAULT_RATING_STATE };
  }

  private async saveRatingState(state: RatingState): Promise<void> {
    await this.dependencies.storage.update(RATING_STATE_KEY, state);
  }

  private async maybePromptForRating(state: RatingState): Promise<void> {
    const now = this.now();
    if (
      !isInstallOldEnough(state.firstSeenAt, now) ||
      state.successCount < SUCCESS_COUNT_THRESHOLD ||
      (state.snoozeUntil !== undefined && now < state.snoozeUntil) ||
      (state.lastPromptAt !== undefined && !isCooldownExpired(state.lastPromptAt, now))
    ) {
      return;
    }

    const selection = await this.dependencies.dialogs.showInfo(
      'Enjoying Module Federation Explorer? Your review helps more teams discover the extension.',
      {
        actions: [
          { title: 'Rate now' },
          { title: 'Already rated' },
          { title: 'Maybe later' },
          { title: "Don't show again" }
        ]
      }
    );
    const nextState: RatingState = { ...state, lastPromptAt: now };

    if (selection === 'Rate now') {
      await this.dependencies.externalLinks.openExternal(MARKETPLACE_REVIEW_URL);
      nextState.hasRated = true;
    } else if (selection === 'Already rated') {
      nextState.hasRated = true;
    } else if (selection === "Don't show again") {
      nextState.neverAskAgain = true;
    } else {
      nextState.snoozeUntil = now + daysToMilliseconds(PROMPT_COOLDOWN_DAYS);
    }

    await this.saveRatingState(nextState);
  }
}

function isRatingState(value: unknown): value is RatingState {
  if (
    !isRecord(value) ||
    typeof value.firstSeenAt !== 'number' ||
    typeof value.successCount !== 'number' ||
    typeof value.hasRated !== 'boolean' ||
    typeof value.neverAskAgain !== 'boolean'
  ) {
    return false;
  }
  return (
    (value.lastPromptAt === undefined || typeof value.lastPromptAt === 'number') &&
    (value.snoozeUntil === undefined || typeof value.snoozeUntil === 'number')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInstallOldEnough(firstSeenAt: number, now: number): boolean {
  return firstSeenAt > 0 && now - firstSeenAt >= daysToMilliseconds(INSTALL_AGE_DAYS_THRESHOLD);
}

function isCooldownExpired(lastPromptAt: number, now: number): boolean {
  return now - lastPromptAt >= daysToMilliseconds(PROMPT_COOLDOWN_DAYS);
}

function daysToMilliseconds(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

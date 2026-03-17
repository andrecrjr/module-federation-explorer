import * as vscode from 'vscode';

const RATING_STATE_KEY = 'ratingPrompt.state';
const EXTENSION_ID = 'acjr.mf-explorer';

const INSTALL_AGE_DAYS_THRESHOLD = 7;
const SUCCESS_COUNT_THRESHOLD = 5;
const PROMPT_COOLDOWN_DAYS = 20;

type SuccessEvent = 'onboarding-complete' | 'remote-started';

interface RatingState {
  firstSeenAt: number;
  successCount: number;
  hasRated: boolean;
  neverAskAgain: boolean;
  lastPromptAt?: number;
  snoozeUntil?: number;
}

const DEFAULT_RATING_STATE: RatingState = {
  firstSeenAt: 0,
  successCount: 0,
  hasRated: false,
  neverAskAgain: false
};

export async function initializeRatingState(context: vscode.ExtensionContext): Promise<void> {
  const state = getRatingState(context);

  if (state.firstSeenAt > 0) {
    return;
  }

  const initializedState: RatingState = {
    ...state,
    firstSeenAt: Date.now()
  };

  await saveRatingState(context, initializedState);
}

export async function trackSuccessAndPrompt(
  context: vscode.ExtensionContext,
  _event: SuccessEvent
): Promise<void> {
  try {
    const state = getRatingState(context);

    if (state.hasRated || state.neverAskAgain) {
      return;
    }

    const updatedState: RatingState = {
      ...state,
      successCount: state.successCount + 1
    };

    await saveRatingState(context, updatedState);
    await maybePromptForRating(context, updatedState);
  } catch (error) {
    console.error('[Module Federation] Failed to track rating prompt state', error);
  }
}

export async function openMarketplaceReview(context: vscode.ExtensionContext): Promise<void> {
  const state = getRatingState(context);
  const now = Date.now();

  const reviewUrl = `https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}&ssr=false#review-details`;
  await vscode.env.openExternal(vscode.Uri.parse(reviewUrl));

  const nextState: RatingState = {
    ...state,
    hasRated: true,
    lastPromptAt: now,
    snoozeUntil: undefined
  };

  await saveRatingState(context, nextState);
}

function getRatingState(context: vscode.ExtensionContext): RatingState {
  return context.globalState.get<RatingState>(RATING_STATE_KEY, DEFAULT_RATING_STATE);
}

async function saveRatingState(context: vscode.ExtensionContext, state: RatingState): Promise<void> {
  await context.globalState.update(RATING_STATE_KEY, state);
}

async function maybePromptForRating(context: vscode.ExtensionContext, state: RatingState): Promise<void> {
  const now = Date.now();

  if (!isInstallOldEnough(state.firstSeenAt, now)) {
    return;
  }

  if (state.successCount < SUCCESS_COUNT_THRESHOLD) {
    return;
  }

  if (state.snoozeUntil && now < state.snoozeUntil) {
    return;
  }

  if (state.lastPromptAt && !isCooldownExpired(state.lastPromptAt, now)) {
    return;
  }

  const selection = await vscode.window.showInformationMessage(
    'Enjoying Module Federation Explorer? Your review helps more teams discover the extension.',
    'Rate now',
    'Already rated',
    'Maybe later',
    "Don't show again"
  );

  const nextState: RatingState = {
    ...state,
    lastPromptAt: now
  };

  if (selection === 'Rate now') {
    const reviewUrl = `https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}&ssr=false#review-details`;
    await vscode.env.openExternal(vscode.Uri.parse(reviewUrl));
    nextState.hasRated = true;
  } else if (selection === 'Already rated') {
    nextState.hasRated = true;
  } else if (selection === "Don't show again") {
    nextState.neverAskAgain = true;
  } else {
    nextState.snoozeUntil = now + daysToMilliseconds(PROMPT_COOLDOWN_DAYS);
  }

  await saveRatingState(context, nextState);
}

function isInstallOldEnough(firstSeenAt: number, now: number): boolean {
  if (!firstSeenAt) {
    return false;
  }

  return now - firstSeenAt >= daysToMilliseconds(INSTALL_AGE_DAYS_THRESHOLD);
}

function isCooldownExpired(lastPromptAt: number, now: number): boolean {
  return now - lastPromptAt >= daysToMilliseconds(PROMPT_COOLDOWN_DAYS);
}

function daysToMilliseconds(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
import * as assert from 'node:assert/strict';
import type { DialogService, ExternalLinkPort, Logger, StoragePort } from '../../../../app/ports';
import { FEEDBACK_URL, FeedbackWorkflow, MARKETPLACE_REVIEW_URL } from '../../../../features/feedback/feedbackWorkflow';

class MemoryStorage implements StoragePort {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }
  async update<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
  read<T>(key: string): T | undefined {
    return this.get<T>(key);
  }
}

function createFeedbackHarness(now: () => number): {
  workflow: FeedbackWorkflow;
  storage: MemoryStorage;
  links: string[];
  infoMessages: string[];
  nextSelection: string | undefined;
} {
  const storage = new MemoryStorage();
  const links: string[] = [];
  const infoMessages: string[] = [];
  const state = { value: undefined as string | undefined };
  const dialogs = {
    showInfo: async (message: string) => {
      infoMessages.push(message);
      return state.value;
    }
  } as unknown as DialogService;
  const externalLinks: ExternalLinkPort = {
    openExternal: async url => {
      links.push(url);
    }
  };
  const logger: Logger = { log: () => {}, logError: () => {} };
  const workflow = new FeedbackWorkflow({ storage, dialogs, externalLinks, logger, now });
  return {
    workflow,
    storage,
    links,
    infoMessages,
    get nextSelection(): string | undefined {
      return state.value;
    },
    set nextSelection(value: string | undefined) {
      state.value = value;
    }
  };
}

suite('Feedback workflow', () => {
  test('initializes state and opens feedback links through ports', async () => {
    const harness = createFeedbackHarness(() => 1000);

    await harness.workflow.initialize();
    await harness.workflow.openFeedback();

    assert.equal(harness.storage.read<{ firstSeenAt: number }>('ratingPrompt.state')?.firstSeenAt, 1000);
    assert.deepEqual(harness.links, [FEEDBACK_URL]);
  });

  test('prompts after install age and success threshold, then snoozes', async () => {
    let now = 1000;
    const harness = createFeedbackHarness(() => now);
    harness.nextSelection = 'Maybe later';

    await harness.workflow.initialize();
    now = 8 * 24 * 60 * 60 * 1000;
    for (let index = 0; index < 5; index++) await harness.workflow.trackSuccess('remote-started');

    const state = harness.storage.read<{ successCount: number; snoozeUntil?: number }>('ratingPrompt.state');
    assert.equal(harness.infoMessages.length, 1);
    assert.equal(state?.successCount, 5);
    assert.equal(state?.snoozeUntil, now + 20 * 24 * 60 * 60 * 1000);
  });

  test('marks marketplace review as rated after opening it', async () => {
    const harness = createFeedbackHarness(() => 42);

    await harness.workflow.openMarketplaceReview();

    assert.deepEqual(harness.links, [MARKETPLACE_REVIEW_URL]);
    assert.equal(harness.storage.read<{ hasRated: boolean }>('ratingPrompt.state')?.hasRated, true);
  });
});

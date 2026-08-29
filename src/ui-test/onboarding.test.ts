import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, suite, test } from 'mocha';
import { By } from 'selenium-webdriver';
import { EditorView, WebView, Workbench } from 'vscode-extension-tester';
import { clickWhenReady, closeEditorsAndTerminals, dismissNotifications, getFixtureWorkspacePath, waitFor } from './testUtils';

suite('Desktop onboarding UI smoke test', function (this: Mocha.Suite) {
  this.timeout(120000);

  afterEach(async function (this: Mocha.Context) {
    this.timeout(30000);
    await closeEditorsAndTerminals();
    const workspacePath = getFixtureWorkspacePath('ui-onboarding');
    await fs.rm(path.join(workspacePath, '.vscode', 'mf-explorer.roots.json'), { force: true });
  });

  test('configures the detected host from the onboarding webview', async () => {
    const workspacePath = getFixtureWorkspacePath('ui-onboarding');
    const configPath = path.join(workspacePath, '.vscode', 'mf-explorer.roots.json');
    await fs.rm(configPath, { force: true });
    await dismissNotifications();

    await waitFor(async () => (await new EditorView().getOpenEditorTitles()).includes('Module Federation Setup'), 15000);
    const onboarding = new WebView();
    await onboarding.switchToFrame(15000);
    try {
      const project = await onboarding.findWebElement(By.css('.project-item'));
      assert.ok(await project.isDisplayed(), 'Detected project must be visible');
      await clickWhenReady(
        () => onboarding.findWebElement(By.id('addBtn')),
        15000,
        'Add Selected Projects button did not become clickable'
      );
    } finally {
      await onboarding.switchBack();
    }

    await waitFor(async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as { roots?: string[] };
        return parsed.roots?.length === 1 && parsed.roots[0] === path.join(workspacePath, 'host');
      } catch {
        return false;
      }
    });
    assert.equal((await new Workbench().getEditorView().getOpenEditorTitles()).includes('Module Federation Setup'), false);
  });
});

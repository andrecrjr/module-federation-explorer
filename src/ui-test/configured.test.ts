import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { beforeEach, afterEach, suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { By, WebElement } from 'selenium-webdriver';
import { InputBox, ModalDialog, WebView, Workbench } from 'vscode-extension-tester';
import {
  clickWhenReady,
  closeEditorsAndTerminals,
  dismissNotifications,
  findNotification,
  findTreeItem,
  getFixtureWorkspacePath,
  getExplorerTree,
  selectTreeContextAction,
  treeHasItem,
  waitFor
} from './testUtils';
import { resetConfiguredFixture } from './prepareConfiguredFixture';

interface TestState {
  workspacePath: string;
  rootPath: string;
  rootConfigPath: string;
}

let state: TestState;

suite('Desktop UI smoke tests', function (this: Mocha.Suite) {
  this.timeout(120000);

  suiteSetup(async function (this: Mocha.Context) {
    this.timeout(120000);
    const workspacePath = getFixtureWorkspacePath('ui-configured');
    const rootPath = path.join(workspacePath, 'host');
    const rootConfigPath = path.join(workspacePath, '.vscode', 'mf-explorer.roots.json');
    state = { workspacePath, rootPath, rootConfigPath };
  });

  beforeEach(async function (this: Mocha.Context) {
    this.timeout(120000);
    await resetConfiguredFixture();
    await dismissNotifications();
    await findTreeItem('host', 1);
  });

  afterEach(async function (this: Mocha.Context) {
    this.timeout(120000);
    await closeEditorsAndTerminals();
  });

  suiteTeardown(async function (this: Mocha.Context) {
    this.timeout(120000);
    await closeEditorsAndTerminals();
    await fs.rm(state.rootConfigPath, { force: true });
  });

  test('opens the explorer tree and exposed module source through clicks', async () => {
    const root = await findTreeItem('host', 1);
    assert.equal(await root.getLabel(), 'host');
    await root.expand();

    const remotesFolder = await findTreeItem('Remotes (1)');
    const exposesFolder = await findTreeItem('Exposed Modules (1)');
    assert.equal(await remotesFolder.getLabel(), 'Remotes (1)');
    assert.equal(await exposesFolder.getLabel(), 'Exposed Modules (1)');

    await exposesFolder.expand();
    const exposedModule = await findTreeItem('./App');
    await exposedModule.select();

    await waitFor(async () => (await new Workbench().getEditorView().getOpenEditorTitles()).includes('App.tsx'));
    assert.ok((await new Workbench().getEditorView().getOpenEditorTitles()).includes('App.tsx'));

  });

  test('starts and stops host and remote terminals through context menus', async () => {
    await fs.rm(path.join(state.rootPath, '.ui-host-start.started'), { force: true });
    await fs.rm(path.join(state.rootPath, 'auth', '.ui-remote-build.started'), { force: true });
    await fs.rm(path.join(state.rootPath, 'auth', '.ui-remote-start.started'), { force: true });

    await selectTreeContextAction('host', 'Start Host App', 1);
    await waitFor(
      () => fileExists(path.join(state.rootPath, '.ui-host-start.started')),
      15000,
      'Host start command did not run from the tree context menu'
    );

    await selectTreeContextAction('host', 'Stop Host App', 1);

    await (await findTreeItem('Remotes (1)')).expand();
    await selectTreeContextAction('auth', 'Start Remote');
    await waitFor(
      () => fileExists(path.join(state.rootPath, 'auth', '.ui-remote-build.started')),
      15000,
      'Remote build command did not run from the tree context menu'
    );
    await waitFor(
      () => fileExists(path.join(state.rootPath, 'auth', '.ui-remote-start.started')),
      15000,
      'Remote start command did not run from the tree context menu'
    );

    await selectTreeContextAction('auth', 'Stop Remote');
  });

  test('adds and removes an external remote through clicks and dialogs', async () => {
    await selectTreeContextAction('Remotes (1)', 'Add External Remote');

    const nameInput = await InputBox.create();
    await nameInput.setText('catalog');
    await nameInput.confirm();
    const urlInput = await InputBox.create();
    await urlInput.setText('https://example.test/remoteEntry.js');
    await urlInput.confirm();
    const external = await findTreeItem('catalog');
    assert.equal(await external.getLabel(), 'catalog');
    await selectTreeContextAction('catalog', 'Remove External Remote');
    const confirmation = await new ModalDialog().wait(15000);
    const confirmationMessage = (await confirmation.getDetails()).replace(/\s+/g, ' ');
    assert.ok(confirmationMessage.includes('Are you sure you want to remove external remote "catalog"?'));
    await confirmation.pushButton('Remove');
    await waitFor(async () => !(await treeHasItem('catalog')));
  });

  test('opens the graph webview and handles a node click', async () => {
    await waitFor(async () => {
      const tree = await getExplorerTree();
      const graphAction = await tree.getAction('Show Dependency Graph');
      if (graphAction) {
        await graphAction.click();
        return true;
      }
      const moreActions = await tree.moreActions();
      if (!moreActions) return false;
      await moreActions.select('Show Dependency Graph');
      return true;
    }, 15000, 'Could not open the dependency graph action');

    await waitFor(async () => (await new Workbench().getEditorView().getOpenEditorTitles()).includes('Module Federation Explorer Graph'));
    const graph = new WebView();
    await graph.switchToFrame(15000);
    try {
      await clickWhenReady(
        () => graph.findWebElement(By.id('reset-view')),
        15000,
        'Graph reset control did not render'
      );
      await clickWhenReady(
        () => graph.findWebElement(By.id('toggle-physics')),
        15000,
        'Graph physics control did not render'
      );
      let hostNode: WebElement | undefined;
      await waitFor(async () => {
        const nodes = await graph.findWebElements(By.css('g[data-testid="graph-node"]'));
        for (const node of nodes) {
          if (await node.getAttribute('aria-label') === 'ui-host (host)') {
            hostNode = await node.findElement(By.css('circle'));
            return true;
          }
        }
        return false;
      }, 15000, 'Graph host node did not render');
      assert.ok(hostNode, 'Graph host node must be available');
      await waitFor(async () => {
        try {
          const rect = await hostNode!.getRect();
          return rect.x > 50 && rect.y > 50 && rect.width > 0 && rect.height > 0;
        } catch {
          return false;
        }
      }, 15000, 'Graph host node did not settle inside the webview');
      await hostNode.click();
    } finally {
      await graph.switchBack();
    }

    const nodeActions = await InputBox.create();
    await nodeActions.selectQuickPick('View Details');
    await findNotification('ui-host (host)');
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

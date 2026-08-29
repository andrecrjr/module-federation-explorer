import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { beforeEach, afterEach, suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { By, WebElement } from 'selenium-webdriver';
import { InputBox, ModalDialog, WebView, Workbench } from 'vscode-extension-tester';
import {
  clickWhenReady,
  clickTreeItemAction,
  closeEditorsAndTerminals,
  dismissNotifications,
  findNotification,
  findTreeItem,
  getFixtureWorkspacePath,
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

interface FixtureConfig {
  roots?: string[];
  rootConfigs?: Record<string, {
    startCommand?: string;
    remotes?: Record<string, {
      folder?: string;
      buildCommand?: string;
      startCommand?: string;
    }>;
  }>;
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
    await new Workbench().executeCommand('Refresh Module Federation Explorer');
    await dismissNotifications();
    await findTreeItem('host', 1, 60000);
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

  test('shows the actionable empty-host state after configuration is cleared', async () => {
    await fs.writeFile(state.rootConfigPath, JSON.stringify({ roots: [] }, null, 2), 'utf8');
    await new Workbench().executeCommand('Refresh');

    await waitFor(async () => !(await treeHasItem('host', 1)), 15000, 'Explorer tree did not clear removed hosts');
    await findNotification('No Host directories are configured.');
    assert.deepEqual((await readFixtureConfig()).roots, []);
  });

  test('edits and persists a host start command through the tree action', async () => {
    const updatedCommand = 'node fixture-process.js host-start-updated';

    await clickTreeItemAction('host', 'Edit Host App Command', 1);
    const editMenu = await InputBox.create();
    await editMenu.selectQuickPick('▶️ Edit Start Command');
    const commandInput = await InputBox.create();
    await commandInput.setText(updatedCommand);
    await commandInput.confirm();

    await waitFor(
      async () => (await readFixtureConfig()).rootConfigs?.[state.rootPath]?.startCommand === updatedCommand,
      15000,
      'Edited host command was not persisted'
    );
    assert.equal(await (await findTreeItem('host', 1)).getLabel(), 'host');
  });

  test('edits and persists a remote build command through the tree action', async () => {
    const updatedCommand = 'node ../fixture-process.js remote-build-updated';
    await (await findTreeItem('Remotes (1)')).expand();

    await clickTreeItemAction('auth', 'Edit Remote Command');
    const editMenu = await InputBox.create();
    await editMenu.selectQuickPick('🔨 Edit Build Command');
    const commandInput = await InputBox.create();
    await commandInput.setText(updatedCommand);
    await commandInput.confirm();

    await waitFor(
      async () => (await readFixtureConfig()).rootConfigs?.[state.rootPath]?.remotes?.auth?.buildCommand === updatedCommand,
      15000,
      'Edited remote command was not persisted'
    );
  });

  test('keeps a host when its removal is canceled', async () => {
    await clickTreeItemAction('host', 'Remove Host Folder', 1);
    const confirmation = await new ModalDialog().wait(15000);
    const confirmationMessage = (await confirmation.getDetails()).replace(/\s+/g, ' ');
    assert.ok(confirmationMessage.includes(`Are you sure you want to remove "${state.rootPath}" from the configuration?`));
    await confirmation.pushButton('Cancel');

    await waitFor(() => treeHasItem('host', 1), 15000, 'Host disappeared after removal was canceled');
    assert.deepEqual((await readFixtureConfig()).roots, [state.rootPath]);
  });

  test('opens the graph webview and handles a node click', async () => {
    await openDependencyGraph();

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
      assert.equal(await (await graph.findWebElement(By.id('stat-hosts'))).getText(), '1');
      assert.equal(await (await graph.findWebElement(By.id('stat-workspace-remotes'))).getText(), '0');
      assert.equal(await (await graph.findWebElement(By.id('stat-modules'))).getText(), '1');
      await clickWhenReady(
        () => graph.findWebElement(By.id('export-graph')),
        15000,
        'Graph export control did not render'
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

  test('opens a workspace configuration from a graph node', async () => {
    await openDependencyGraph();
    const graph = new WebView();
    await graph.switchToFrame(15000);
    try {
      const hostNode = await findGraphNode(graph, 'ui-host (host)');
      await hostNode.click();
    } finally {
      await graph.switchBack();
    }

    const nodeActions = await InputBox.create();
    await nodeActions.selectQuickPick('Open Config');
    await waitFor(
      async () => (await new Workbench().getEditorView().getOpenEditorTitles()).includes('webpack.config.js'),
      15000,
      'Graph node did not open its workspace configuration'
    );
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

async function readFixtureConfig(): Promise<FixtureConfig> {
  return JSON.parse(await fs.readFile(state.rootConfigPath, 'utf8')) as FixtureConfig;
}

async function openDependencyGraph(): Promise<void> {
  await new Workbench().executeCommand('Show Dependency Graph');

  await waitFor(
    async () => (await new Workbench().getEditorView().getOpenEditorTitles()).includes('Module Federation Explorer Graph'),
    15000,
    'Dependency graph editor did not open'
  );
}

async function findGraphNode(graph: WebView, ariaLabel: string): Promise<WebElement> {
  let node: WebElement | undefined;
  await waitFor(async () => {
    const nodes = await graph.findWebElements(By.css('g[data-testid="graph-node"]'));
    for (const candidate of nodes) {
      if (await candidate.getAttribute('aria-label') === ariaLabel) {
        node = await candidate.findElement(By.css('circle'));
        return true;
      }
    }
    return false;
  }, 15000, `Graph node did not render: ${ariaLabel}`);
  if (!node) throw new Error(`Graph node did not render: ${ariaLabel}`);
  return node;
}

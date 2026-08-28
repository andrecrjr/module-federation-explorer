import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { By, WebElement } from 'selenium-webdriver';
import { InputBox, ModalDialog, VSBrowser, WebView, Workbench } from 'vscode-extension-tester';
import {
  closeEditorsAndTerminals,
  findNotification,
  findTreeItem,
  getFixtureWorkspacePath,
  getExplorerTree,
  selectTreeContextAction,
  treeHasItem,
  waitFor
} from './testUtils';

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

    await findTreeItem('host', 1);
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
      try {
        const tree = await getExplorerTree();
        await VSBrowser.instance.driver.actions().move({ x: 1000, y: 300 }).perform();
        const graphAction = await tree.getAction('Show Dependency Graph');
        if (graphAction) {
          await graphAction.click();
          return true;
        }
        const moreActions = await tree.moreActions();
        if (!moreActions) return false;
        await moreActions.select('Show Dependency Graph');
        return true;
      } catch {
        return false;
      }
    }, 15000, 'Could not open the dependency graph action');

    await waitFor(async () => (await new Workbench().getEditorView().getOpenEditorTitles()).includes('Module Federation Explorer Graph'));
    const graph = new WebView();
    await graph.switchToFrame(15000);
    try {
      await waitFor(async () => {
        try {
          await (await graph.findWebElement(By.id('reset-view'))).click();
          return true;
        } catch {
          return false;
        }
      }, 15000, 'Graph reset control did not render');
      await waitFor(async () => {
        try {
          await (await graph.findWebElement(By.id('toggle-physics'))).click();
          return true;
        } catch {
          return false;
        }
      }, 15000, 'Graph physics control did not render');
      let hostNode: WebElement | undefined;
      await waitFor(async () => {
        try {
          const circles = await graph.findWebElements(By.css('g.node circle'));
          for (const circle of circles) {
            const className = await circle.getAttribute('class');
            if (className?.split(/\s+/).some(value => value === 'host-node' || value === 'bidirectional-node')) {
              hostNode = circle;
              return true;
            }
          }
        } catch {
          return false;
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
      const graphSvg = await graph.findWebElement(By.css('svg'));
      const svgRect = await graphSvg.getRect();
      const nodeRect = await hostNode.getRect();
      const nodeCenterX = nodeRect.x - svgRect.x + nodeRect.width / 2;
      const nodeCenterY = nodeRect.y - svgRect.y + nodeRect.height / 2;
      const hitTarget = await VSBrowser.instance.driver.executeScript<{
        tagName: string;
        className: string;
        parentClass: string;
      }>((x: number, y: number) => {
        type DomElement = {
          tagName?: string;
          getAttribute: (name: string) => string | null;
          parentElement?: DomElement | null;
        };
        const documentRef = (globalThis as unknown as {
          document: { elementFromPoint: (x: number, y: number) => DomElement | null };
        }).document;
        const element = documentRef.elementFromPoint(x, y);
        return {
          tagName: element?.tagName ?? '',
          className: element?.getAttribute('class') ?? '',
          parentClass: element?.parentElement?.getAttribute('class') ?? ''
        };
      }, nodeCenterX, nodeCenterY);
      assert.equal(hitTarget.tagName, 'circle', `Graph node hit test found ${JSON.stringify(hitTarget)}`);
      // ChromeDriver's top-level pointer dispatch does not reliably enter nested VS Code webview frames.
      await VSBrowser.instance.driver.executeScript((element: unknown) => {
        const page = globalThis as unknown as {
          MouseEvent: new (type: string, options: { bubbles: boolean; cancelable: boolean; view: unknown }) => unknown;
        };
        (element as { dispatchEvent: (event: unknown) => boolean }).dispatchEvent(new page.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: globalThis
        }));
      }, hostNode);
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

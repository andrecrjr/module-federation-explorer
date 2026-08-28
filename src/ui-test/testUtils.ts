import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { By } from 'selenium-webdriver';
import {
  ActivityBar,
  CustomTreeSection,
  CustomTreeItem,
  Notification,
  NotificationType,
  SideBarView,
  VSBrowser,
  Workbench
} from 'vscode-extension-tester';

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15000,
  message = 'Timed out waiting for UI state'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

export function getFixtureWorkspacePath(name: string): string {
  return path.resolve(__dirname, '../../../src/test/fixtures', name);
}

export async function getExplorerTree(): Promise<CustomTreeSection> {
  const activityBar = new ActivityBar();
  const explorerControl = await activityBar.getViewControl('Explorer');
  assert.ok(explorerControl, 'Explorer activity-bar view must be available');
  await explorerControl.openView();

  const content = await new SideBarView().getContent();
  return content.getSection('Module Federation Explorer', CustomTreeSection);
}

export async function findTreeItem(label: string, maxLevel = 0): Promise<CustomTreeItem> {
  let item: CustomTreeItem | undefined;
  await waitFor(async () => {
    const tree = await getExplorerTree();
    if (!(await tree.isExpanded())) {
      await (await tree.findElement(By.className('twisty-container'))).click();
      await waitFor(() => tree.isExpanded(), 5000, 'Explorer tree section did not expand');
    }
    const rows = await tree.findElements(By.css('.monaco-list-row'));
    for (const row of rows) {
      try {
        const candidate = new CustomTreeItem(row, tree);
        if (await candidate.getLabel() !== label) continue;
        const level = Number(await row.getAttribute('aria-level'));
        if (maxLevel < 1 || level <= maxLevel) {
          item = candidate;
          break;
        }
      } catch {
        // Tree refreshes replace rows; retry the lookup against the new tree.
      }
    }
    return item !== undefined;
  }, 15000, `Tree item not found: ${label}`);
  if (!item) throw new Error(`Tree item not found: ${label}`);
  return item;
}

export async function treeHasItem(label: string, maxLevel = 0): Promise<boolean> {
  try {
    const tree = await getExplorerTree();
    if (!(await tree.isExpanded())) {
      await (await tree.findElement(By.className('twisty-container'))).click();
      await waitFor(() => tree.isExpanded(), 5000, 'Explorer tree section did not expand');
    }
    const rows = await tree.findElements(By.css('.monaco-list-row'));
    for (const row of rows) {
      const candidate = new CustomTreeItem(row, tree);
      if (await candidate.getLabel() !== label) continue;
      const level = Number(await row.getAttribute('aria-level'));
      if (maxLevel < 1 || level <= maxLevel) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function selectTreeContextAction(
  label: string,
  action: string,
  maxLevel = 0
): Promise<void> {
  await waitFor(async () => {
    try {
      const item = await findTreeItem(label, maxLevel);
      const menu = await item.openContextMenu();
      if (!menu) return false;
      const labels = await Promise.all((await menu.getItems()).map(item => item.getLabel()));
      if (!labels.includes(action)) {
        await menu.close();
        return false;
      }
      await menu.select(action);
      return true;
    } catch {
      return false;
    }
  }, 15000, `Could not select '${action}' for tree item '${label}'`);
}

export async function clickTreeItemAction(
  label: string,
  action: string,
  maxLevel = 0
): Promise<void> {
  await waitFor(async () => {
    try {
      const item = await findTreeItem(label, maxLevel);
      const actionButton = await item.getActionButton(action);
      if (!actionButton) return false;
      await actionButton.click();
      return true;
    } catch {
      return false;
    }
  }, 15000, `Could not click '${action}' for tree item '${label}'`);
}

export async function findNotification(message: string): Promise<Notification> {
  let result: Notification | undefined;
  await waitFor(async () => {
    const workbench = new Workbench();
    const notifications = await workbench.getNotifications();
    for (const notification of notifications) {
      if ((await notification.getMessage()).includes(message)) {
        result = notification;
        return true;
      }
    }

    try {
      const center = await workbench.openNotificationsCenter();
      const centerNotifications = await center.getNotifications(NotificationType.Any);
      for (const notification of centerNotifications) {
        if ((await notification.getMessage()).includes(message)) {
          result = notification;
          await center.close();
          return true;
        }
      }
      await center.close();
    } catch {
      // The notification center may be unavailable while the workbench is changing views.
    }
    return false;
  }, 15000, `Notification not found: ${message}`);
  assert.ok(result, `Notification not found: ${message}`);
  return result;
}

export async function closeEditorsAndTerminals(): Promise<void> {
  await new Workbench().getEditorView().closeAllEditors().catch(() => undefined);
  await new Workbench().getBottomBar().closePanel().catch(() => undefined);
}

export function takeFailureScreenshot(name: string): void {
  void VSBrowser.instance.takeScreenshot(name);
}

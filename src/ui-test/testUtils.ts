import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { By, WebElement } from 'selenium-webdriver';
import {
  ActivityBar,
  CustomTreeSection,
  CustomTreeItem,
  Notification,
  NotificationType,
  SideBarView,
  Workbench
} from 'vscode-extension-tester';

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15000,
  message = 'Timed out waiting for UI state'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const details = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`${message}.${details}`);
}

/** Dismiss transient workbench notifications that can intercept UI clicks. */
export async function dismissNotifications(): Promise<void> {
  const workbench = new Workbench();
  try {
    const notifications = await workbench.getNotifications();
    if (notifications.length === 0) return;
    await dismissNotificationList(notifications);
  } catch (error) {
    reportCleanupFailure('visible notifications', error);
  }

  try {
    const center = await workbench.openNotificationsCenter();
    await dismissNotificationList(await center.getNotifications(NotificationType.Any));
    await center.close();
  } catch (error) {
    reportCleanupFailure('notification center', error);
  }
}

async function dismissNotificationList(notifications: Notification[]): Promise<void> {
  for (const notification of notifications) {
    try {
      await notification.dismiss();
    } catch (error) {
      reportCleanupFailure('notification', error);
    }
  }
}

/** Click an element after it is displayed, enabled, and no longer blocked by a toast. */
export async function clickWhenReady(
  findElement: () => Promise<WebElement>,
  timeoutMs = 15000,
  message = 'UI element did not become clickable'
): Promise<void> {
  await waitFor(async () => {
    await dismissNotifications();
    const element = await findElement();
    if (!await element.isDisplayed() || !await element.isEnabled()) return false;
    await element.click();
    return true;
  }, timeoutMs, message);
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
  }, 15000, `Could not select '${action}' for tree item '${label}'`);
}

export async function clickTreeItemAction(
  label: string,
  action: string,
  maxLevel = 0
): Promise<void> {
  await waitFor(async () => {
    const item = await findTreeItem(label, maxLevel);
    const actionButton = await item.getActionButton(action);
    if (!actionButton) return false;
    await actionButton.click();
    return true;
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
  const workbench = new Workbench();
  await runCleanupCommand(workbench, 'workbench.action.terminal.killAll', 'terminals');
  await runCleanupCommand(workbench, 'workbench.action.closeAllEditors', 'editors');
  await runCleanupCommand(workbench, 'workbench.action.closePanel', 'bottom panel');
  await dismissNotifications();
}

async function runCleanupCommand(workbench: Workbench, command: string, target: string): Promise<void> {
  try {
    await workbench.executeCommand(command);
  } catch (error) {
    reportCleanupFailure(target, error);
  }
}

function reportCleanupFailure(target: string, error: unknown): void {
  const details = error instanceof Error ? error.message : String(error);
  console.warn(`[ui-test] Could not clean up ${target}: ${details}`);
}

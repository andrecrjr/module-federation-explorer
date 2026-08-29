import * as vscode from 'vscode';

/** Opens the extension welcome panel and keeps its message handling local to the UI feature. */
export function showWelcomePage(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'moduleFederationWelcome',
    'Welcome to Module Federation Explorer',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  panel.webview.html = getWelcomePageHtml(context, panel.webview);
  panel.webview.onDidReceiveMessage(
    message => {
      if (!isWelcomeMessage(message)) return;

      switch (message.command) {
        case 'openExtensionExplorer':
          void vscode.commands.executeCommand('moduleFederation.openView');
          break;
        case 'openDocs':
          void vscode.env.openExternal(vscode.Uri.parse('https://github.com/andrecrjr/module-federation-explorer'));
          break;
        case 'openFeedback':
          void vscode.env.openExternal(
            vscode.Uri.parse('https://acjr.notion.site/202b5e58148c8017ba2ad355fc377e4b?pvs=105')
          );
          break;
      }
    },
    undefined,
    context.subscriptions
  );
  context.subscriptions.push(panel);
}

function isWelcomeMessage(
  message: unknown
): message is { command: 'openExtensionExplorer' | 'openDocs' | 'openFeedback' } {
  if (!message || typeof message !== 'object' || !('command' in message)) return false;
  const command = (message as { command?: unknown }).command;
  return command === 'openExtensionExplorer' || command === 'openDocs' || command === 'openFeedback';
}

function getWelcomePageHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'mfe-explorer-logo-big.png'));
  const graphUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'dependency-graph.png'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Module Federation Explorer</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; max-width: 900px; margin: 0 auto; line-height: 1.5; }
    .container { display: flex; flex-direction: column; align-items: center; text-align: center; }
    .logo { max-width: 150px; margin-bottom: 16px; }
    h1 { color: var(--vscode-editor-foreground); }
    .graph { max-width: 100%; max-height: 260px; margin: 16px 0; border-radius: 8px; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
    button { padding: 10px 18px; border: 0; border-radius: 4px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="container">
    <img src="${logoUri}" alt="Module Federation Explorer Logo" class="logo">
    <h1>Welcome to Module Federation Explorer</h1>
    <p>Explore Module Federation projects, manage host and remote terminals, and visualize dependencies directly in VS Code.</p>
    <img src="${graphUri}" alt="Dependency graph preview" class="graph">
    <div class="actions">
      <button id="openExplorerBtn">Open Explorer</button>
      <button id="openDocsBtn">Documentation</button>
      <button id="feedbackBtn">Share Feedback</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('openExplorerBtn').addEventListener('click', () => vscode.postMessage({ command: 'openExtensionExplorer' }));
    document.getElementById('openDocsBtn').addEventListener('click', () => vscode.postMessage({ command: 'openDocs' }));
    document.getElementById('feedbackBtn').addEventListener('click', () => vscode.postMessage({ command: 'openFeedback' }));
  </script>
</body>
</html>`;
}

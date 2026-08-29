import * as vscode from 'vscode';
import type { DetectedProject } from './types';

export function getOnboardingHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  projects: readonly DetectedProject[],
  existingRoots: readonly string[]
): string {
  const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'mfe-explorer-logo-big.png'));
  const hostOptions = [...new Set([...existingRoots, ...projects.map(project => project.path)])]
    .map(
      hostPath =>
        `<option value="${escapeHtml(hostPath)}">${escapeHtml(vscode.workspace.asRelativePath(hostPath, false))}</option>`
    )
    .join('');
  const projectItems = projects
    .map((project, index) => {
      const remotes =
        project.remotes.length > 0
          ? `<div class="remotes-list"><span class="remotes-label">Detected Remotes:</span>${project.remotes
              .map(remote => `<span class="remote-tag">${escapeHtml(remote.name)}</span>`)
              .join('')}</div>`
          : '<div class="remotes-list"><span class="remotes-label no-remotes">No remotes detected</span></div>';

      return `<div class="project-item" id="item-${index}">
      <input type="checkbox" class="project-checkbox" id="proj-${index}" value="${escapeHtml(project.path)}" checked />
      <div class="project-info">
        <label for="proj-${index}" class="project-label">
          <span class="project-header"><span class="project-name">${escapeHtml(project.name)}</span><span class="config-type-tag ${escapeHtml(project.configType)}">${escapeHtml(project.configType)}</span></span>
          <span class="path-details">${escapeHtml(vscode.workspace.asRelativePath(project.path, false))}</span>
        </label>
        ${remotes}
        <div class="role-config">
          <label for="role-${index}">Import as:</label>
          <select id="role-${index}" class="role-select" data-idx="${index}">
            <option value="host" selected>Host</option><option value="remote">Remote</option>
          </select>
          <div class="host-selection" id="host-selection-${index}">
            <label for="host-${index}">Belongs to Host:</label>
            <select id="host-${index}" class="host-select" data-idx="${index}">
              <option value="" disabled selected>Select a Host...</option>${hostOptions}<option value="custom">Choose Folder...</option>
            </select>
            <span class="custom-host-display" id="custom-host-display-${index}">
              <span class="custom-path" id="custom-path-${index}"></span>
              <button class="button secondary browse-btn" data-idx="${index}">Browse...</button>
            </span>
          </div>
        </div>
      </div>
    </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Module Federation Setup</title>
  <style>
    :root { --primary: var(--vscode-button-background); --primary-hover: var(--vscode-button-hoverBackground); --bg: var(--vscode-editor-background); --fg: var(--vscode-foreground); --border: var(--vscode-widget-border); --input-bg: var(--vscode-input-background); --desc: var(--vscode-descriptionForeground); }
    body { font-family: var(--vscode-font-family); color: var(--fg); padding: 40px 20px; max-width: 800px; margin: 0 auto; line-height: 1.6; background: var(--bg); }
    .container { display: flex; flex-direction: column; align-items: center; text-align: center; } .logo { max-width: 100px; margin-bottom: 24px; }
    h1 { font-size: 2.5em; margin: 0 0 8px; } .subtitle { font-size: 1.2em; color: var(--desc); margin: 0 0 40px; max-width: 600px; }
    .projects-container { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; width: 100%; text-align: left; box-sizing: border-box; box-shadow: 0 8px 24px rgba(0,0,0,.15); }
    .project-item { display: flex; align-items: flex-start; margin-bottom: 16px; padding: 16px; background: var(--input-bg); border-radius: 8px; border: 1px solid transparent; } .project-item:hover { border-color: var(--primary); } .project-item.disabled { opacity: .5; } .project-item.disabled .role-config { pointer-events: none; }
    .project-checkbox { margin: 4px 16px 0 0; cursor: pointer; transform: scale(1.3); accent-color: var(--primary); } .project-info { flex: 1; } .project-label { display: block; cursor: pointer; } .project-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; } .project-name { font-size: 1.15em; font-weight: 600; }
    .config-type-tag { font-size: .75em; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; font-weight: 700; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); } .path-details { font-size: .9em; color: var(--desc); font-family: monospace; margin-bottom: 12px; display: block; }
    .remotes-list { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 8px; opacity: .9; } .remotes-label { font-size: .8em; font-weight: 600; color: var(--desc); } .no-remotes { font-style: italic; font-weight: 400; } .remote-tag { font-size: .8em; padding: 2px 10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 4px; border: 1px solid var(--border); }
    .role-config { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); } .host-selection { display: none; align-items: center; gap: 8px; margin-top: 8px; } select { padding: 4px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; } .custom-host-display { display: none; align-items: center; gap: 8px; } .custom-path { color: var(--desc); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { margin-top: 40px; display: flex; gap: 20px; justify-content: center; } .button { padding: 12px 32px; background: var(--primary); color: var(--vscode-button-foreground); border: 0; border-radius: 6px; cursor: pointer; font-size: 1.1em; font-weight: 600; } .button:hover { background: var(--primary-hover); } .button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style>
</head>
<body>
  <div class="container"><img src="${escapeHtml(logoUri.toString())}" alt="Module Federation Explorer Logo" class="logo" />
    <h1>Welcome!</h1><p class="subtitle">We detected Module Federation in your workspace. Select the projects you want to manage in the Explorer.</p>
    <div class="projects-container"><div id="projects-list">${projectItems}</div></div>
    <div class="actions"><button class="button secondary" id="skipBtn" aria-label="Skip onboarding">Skip for now</button><button class="button" id="addBtn" aria-label="Add selected projects">Add Selected Projects</button></div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const browse = idx => vscode.postMessage({ command: 'browseHostFolder', idx: Number(idx) });
    document.querySelectorAll('.project-checkbox').forEach(cb => cb.addEventListener('change', event => {
      const target = event.target; const item = document.getElementById('item-' + target.id.replace('proj-', '')); if (item) item.classList.toggle('disabled', !target.checked);
    }));
    document.querySelectorAll('.role-select').forEach(select => select.addEventListener('change', event => {
      const target = event.target; const host = document.getElementById('host-selection-' + target.dataset.idx); if (host) host.style.display = target.value === 'remote' ? 'flex' : 'none';
    }));
    document.querySelectorAll('.host-select').forEach(select => select.addEventListener('change', event => {
      const target = event.target; const display = document.getElementById('custom-host-display-' + target.dataset.idx); if (!display) return; if (target.value === 'custom') browse(target.dataset.idx); else display.style.display = 'none';
    }));
    document.querySelectorAll('.browse-btn').forEach(button => button.addEventListener('click', event => browse(event.target.dataset.idx)));
    window.addEventListener('message', event => {
      const message = event.data; if (!message || message.command !== 'hostFolderSelected' || typeof message.idx !== 'number' || typeof message.folder !== 'string') return;
      const select = document.getElementById('host-' + message.idx); const display = document.getElementById('custom-host-display-' + message.idx); const path = document.getElementById('custom-path-' + message.idx); if (!select || !display || !path) return;
      const option = [...select.options].find(item => item.value === message.folder); if (option) { select.value = message.folder; display.style.display = 'none'; } else { select.value = 'custom'; select.dataset.customFolder = message.folder; path.textContent = message.folder; path.title = message.folder; display.style.display = 'flex'; }
    });
    document.getElementById('addBtn').addEventListener('click', () => {
      const items = [...document.querySelectorAll('.project-checkbox:checked')].map(cb => { const idx = cb.id.replace('proj-', ''); const role = document.getElementById('role-' + idx).value; const host = document.getElementById('host-' + idx); const hostFolder = role === 'remote' ? (host.value === 'custom' ? host.dataset.customFolder || null : host.value) : null; return { path: cb.value, role, hostFolder }; });
      vscode.postMessage({ command: 'addSelectedFolders', items });
    });
    document.getElementById('skipBtn').addEventListener('click', () => vscode.postMessage({ command: 'skipOnboarding' }));
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character
  );
}

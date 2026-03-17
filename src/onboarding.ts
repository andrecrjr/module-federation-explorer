import * as vscode from 'vscode';
import * as path from 'path';
import { UnifiedModuleFederationProvider } from './unifiedTreeProvider';
import { DetectedProject } from './workspaceScanner';
import { trackSuccessAndPrompt } from './ratingPrompt';

export async function showOnboardingPage(
  context: vscode.ExtensionContext,
  provider: UnifiedModuleFederationProvider,
  detectedProjects: DetectedProject[]
) {
  const panel = vscode.window.createWebviewPanel(
    'moduleFederationOnboarding',
    'Module Federation Setup',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  let existingRoots: string[] = [];
  try {
    const config = await provider['rootConfigManager'].loadRootConfig();
    if (config && config.roots) {
      existingRoots = config.roots;
    }
  } catch (e) {
    console.error('Failed to load existing roots for onboarding', e);
  }

  panel.webview.html = getOnboardingHtml(context, panel.webview, detectedProjects, existingRoots);

  // Handle webview messages
  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'browseHostFolder':
          const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Host Folder'
          });
          if (uri && uri[0]) {
            panel.webview.postMessage({ command: 'hostFolderSelected', idx: message.idx, folder: uri[0].fsPath });
          }
          return;

        case 'addSelectedFolders':
          const { items } = message;
          if (items && Array.isArray(items) && items.length > 0) {
            try {
              // Ensure configuration file exists
              let configPath = provider['rootConfigManager'].getConfigPath();
              if (!configPath) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                  configPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'mf-explorer.roots.json');
                  await provider['rootConfigManager'].setConfigPath(configPath);
                }
              }

              // Load existing config
              let config = await provider['rootConfigManager'].loadRootConfig();
              if (!config) {
                config = { roots: [] };
              }
              config.rootConfigs = config.rootConfigs || {};

              // Process each item
              for (const item of items) {
                const { path: itemPath, role, hostFolder } = item;
                const project = detectedProjects.find(p => p.path === itemPath);

                if (role === 'host') {
                  if (!config.roots.includes(itemPath)) {
                    config.roots.push(itemPath);
                  }

                  // Auto-link remotes
                  if (project && project.remotes && project.remotes.length > 0) {
                    config.rootConfigs[itemPath] = config.rootConfigs[itemPath] || {};
                    config.rootConfigs[itemPath].remotes = config.rootConfigs[itemPath].remotes || {};

                    for (const remote of project.remotes) {
                      const remoteProject = detectedProjects.find(p => p.name === remote.name || (remote.url && p.name && remote.url.includes(p.name)));
                      if (remoteProject) {
                        config.rootConfigs[itemPath].remotes![remote.name] = {
                          name: remote.name,
                          url: remote.url,
                          folder: remoteProject.path,
                          configType: remoteProject.configType === 'rspack' ? 'webpack' : remoteProject.configType,
                          packageManager: 'npm'
                        };
                      }
                    }
                  }
                } else if (role === 'remote') {
                  if (!hostFolder) {
                    vscode.window.showWarningMessage(`No Host specified for remote at ${itemPath}`);
                    continue;
                  }

                  // Ensure host folder is in roots
                  if (!config.roots.includes(hostFolder)) {
                    config.roots.push(hostFolder);
                  }

                  config.rootConfigs[hostFolder] = config.rootConfigs[hostFolder] || {};
                  config.rootConfigs[hostFolder].remotes = config.rootConfigs[hostFolder].remotes || {};

                  const remoteName = project?.name || path.basename(itemPath);

                  config.rootConfigs[hostFolder].remotes![remoteName] = {
                    name: remoteName,
                    folder: itemPath,
                    configType: project?.configType === 'rspack' ? 'webpack' : (project?.configType || 'webpack'),
                    packageManager: 'npm'
                  };
                }
              }

              await provider['rootConfigManager'].saveRootConfig(config);

              // Reload tree configuration to reflect new roots
              await provider.reloadConfigurations();

              // Reveal the Module Federation panel
              vscode.commands.executeCommand('moduleFederation.reveal');

              vscode.window.showInformationMessage(`Successfully configured ${items.length} Module Federation project(s)!`);
              await trackSuccessAndPrompt(context, 'onboarding-complete');

              // Close the onboarding panel
              panel.dispose();
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              vscode.window.showErrorMessage(`Failed to save configurations: ${errorMessage}`);
            }
          } else {
            vscode.window.showWarningMessage('No projects selected to add.');
          }
          return;

        case 'skipOnboarding':
          panel.dispose();
          return;
      }
    },
    undefined,
    context.subscriptions
  );
}

function getOnboardingHtml(context: vscode.ExtensionContext, webview: vscode.Webview, projects: DetectedProject[], existingRoots: string[]): string {
  const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'mfe-explorer-logo-big.png'));

  const allHostOptions = new Set<string>([...existingRoots]);
  projects.forEach(p => allHostOptions.add(p.path));

  const hostOptionsHtml = Array.from(allHostOptions).map(hostPath => {
    return `<option value="${hostPath}">${vscode.workspace.asRelativePath(hostPath, false)}</option>`;
  }).join('');

  // Create an HTML list of the detected projects
  const projectItems = projects.map((proj, idx) => {
    const relativePath = vscode.workspace.asRelativePath(proj.path, false);
    const remotesHtml = proj.remotes.length > 0
      ? `<div class="remotes-list">
                 <span class="remotes-label">Detected Remotes:</span>
                 ${proj.remotes.map(r => `<span class="remote-tag">${r.name}</span>`).join('')}
               </div>`
      : '<div class="remotes-list"><span class="remotes-label no-remotes">No remotes detected</span></div>';

    return `
      <div class="project-item" id="item-${idx}">
        <input type="checkbox" class="project-checkbox" id="proj-${idx}" value="${proj.path}" checked />
        <div class="project-info">
          <label for="proj-${idx}" style="cursor: pointer; display: block;">
            <div class="project-header">
                <span class="project-name">${proj.name}</span>
                <span class="config-type-tag ${proj.configType}">${proj.configType}</span>
            </div>
            <span class="path-details">${relativePath}</span>
          </label>
          ${remotesHtml}
          
          <div class="role-config" id="role-config-${idx}" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
             <label for="role-${idx}" style="font-weight: 600; font-size: 0.9em;">Import as:</label>
             <select id="role-${idx}" class="role-select" data-idx="${idx}" style="margin-left: 8px; padding: 4px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px;">
                <option value="host" selected>Host</option>
                <option value="remote">Remote</option>
             </select>
             
             <div class="host-selection" id="host-selection-${idx}" style="display: none; margin-top: 8px; align-items: center; gap: 8px;">
                <label for="host-${idx}" style="font-weight: 600; font-size: 0.9em; color: var(--desc);">Belongs to Host:</label>
                <select id="host-${idx}" class="host-select" data-idx="${idx}" style="padding: 4px; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; max-width: 250px;">
                   <option value="" disabled selected>Select a Host...</option>
                   ${hostOptionsHtml}
                   <option value="custom">Choose Folder...</option>
                </select>
                <div class="custom-host-display" id="custom-host-display-${idx}" style="display: none; align-items: center; gap: 8px;">
                   <span class="custom-path path-details" id="custom-path-${idx}" style="margin-bottom: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                   <button class="button secondary browse-btn" data-idx="${idx}" style="padding: 4px 8px; font-size: 0.8em; margin: 0;">Browse...</button>
                </div>
             </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Module Federation Setup</title>
      <style>
        :root {
            --primary: var(--vscode-button-background);
            --primary-hover: var(--vscode-button-hoverBackground);
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-foreground);
            --border: var(--vscode-widget-border);
            --input-bg: var(--vscode-input-background);
            --desc: var(--vscode-descriptionForeground);
        }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; 
          color: var(--fg);
          padding: 40px 20px;
          max-width: 800px;
          margin: 0 auto; 
          line-height: 1.6;
          background-color: var(--bg);
        }
        .container { 
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .logo {
          max-width: 100px;
          margin-bottom: 24px;
        }
        h1 {
          font-size: 2.5em;
          margin-bottom: 8px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        p.subtitle {
          font-size: 1.2em;
          color: var(--desc);
          margin-bottom: 40px;
          max-width: 600px;
        }
        .projects-container {
          background-color: var(--bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 24px;
          width: 100%;
          text-align: left;
          box-sizing: border-box;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }
        .projects-container h3 {
          margin-top: 0;
          font-size: 1.3em;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border);
        }
        .project-item {
          display: flex;
          align-items: flex-start;
          margin-bottom: 16px;
          padding: 16px;
          background: var(--input-bg);
          border-radius: 8px;
          border: 1px solid transparent;
          transition: all 0.2s ease;
        }
        .project-item:hover {
            border-color: var(--primary);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .project-item.disabled {
            opacity: 0.5;
        }
        .project-item.disabled .role-config {
            pointer-events: none;
        }
        .project-item input[type="checkbox"] {
          margin-top: 4px;
          margin-right: 16px;
          cursor: pointer;
          transform: scale(1.3);
          accent-color: var(--primary);
        }
        .project-info {
           flex: 1;
           display: flex;
           flex-direction: column;
        }
        .project-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 4px;
        }
        .project-name {
            font-size: 1.15em;
            font-weight: 600;
        }
        .config-type-tag {
            font-size: 0.75em;
            padding: 2px 8px;
            border-radius: 10px;
            text-transform: uppercase;
            font-weight: 700;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .config-type-tag.vite { background: #646cff; color: white; }
        .config-type-tag.webpack { background: #1c78c0; color: white; }
        .config-type-tag.rspack { background: #f8df1d; color: black; }
        .config-type-tag.modernjs { background: #0070f3; color: white; }

        .path-details {
          font-size: 0.9em;
          color: var(--desc);
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          margin-bottom: 12px;
          display: block;
        }
        .remotes-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            padding-top: 8px;
            /* border-top removed to avoid back-to-back borders with role-config */
            opacity: 0.9;
        }
        .remotes-label {
            font-size: 0.8em;
            font-weight: 600;
            color: var(--desc);
            margin-right: 4px;
        }
        .no-remotes { font-style: italic; font-weight: 400; }
        .remote-tag {
            font-size: 0.8em;
            padding: 2px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            border: 1px solid var(--border);
        }
        .actions {
          margin-top: 40px;
          display: flex;
          gap: 20px;
          justify-content: center;
        }
        .button {
          padding: 12px 32px;
          background-color: var(--primary);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1.1em;
          font-weight: 600;
          transition: transform 0.1s, background-color 0.2s;
        }
        .button:hover {
          background-color: var(--primary-hover);
          transform: translateY(-1px);
        }
        .button:active {
            transform: translateY(1px);
        }
        .button.secondary {
          background-color: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        .button.secondary:hover {
          background-color: var(--vscode-button-secondaryHoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <img src="${logoUri}" alt="Module Federation Explorer Logo" class="logo" />
        <h1>Welcome!</h1>
        <p class="subtitle">We detected Module Federation in your workspace. Select the projects you want to manage in the Explorer.</p>
        
        <div class="projects-container">
          <div id="projects-list">
            ${projectItems}
          </div>
        </div>

        <div class="actions">
          <button class="button secondary" id="skipBtn">Skip for now</button>
          <button class="button" id="addBtn">Add Selected Projects</button>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        // Handle Checkbox Toggle
        document.querySelectorAll('.project-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = e.target.id.replace('proj-', '');
                const itemDiv = document.getElementById('item-' + idx);
                if (e.target.checked) {
                    itemDiv.classList.remove('disabled');
                } else {
                    itemDiv.classList.add('disabled');
                }
            });
        });

        // Handle Role Select
        document.querySelectorAll('.role-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = e.target.dataset.idx;
                const role = e.target.value;
                const hostSelectionDiv = document.getElementById('host-selection-' + idx);
                if (role === 'remote') {
                    hostSelectionDiv.style.display = 'flex';
                } else {
                    hostSelectionDiv.style.display = 'none';
                }
            });
        });

        // Handle Host Select
        document.querySelectorAll('.host-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = e.target.dataset.idx;
                const val = e.target.value;
                if (val === 'custom') {
                    vscode.postMessage({ command: 'browseHostFolder', idx: idx });
                } else {
                    document.getElementById('custom-host-display-' + idx).style.display = 'none';
                }
            });
        });

        // Handle Browse buttons
        document.querySelectorAll('.browse-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.dataset.idx;
                vscode.postMessage({ command: 'browseHostFolder', idx: idx });
            });
        });

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'hostFolderSelected') {
                const idx = message.idx;
                const folder = message.folder;
                
                const selectElement = document.getElementById('host-' + idx);
                // Check if the option already exists and select it
                let optionExists = false;
                for (let i = 0; i < selectElement.options.length; i++) {
                    if (selectElement.options[i].value === folder) {
                        selectElement.selectedIndex = i;
                        optionExists = true;
                        break;
                    }
                }
                
                if (!optionExists) {
                    // Update the select to stay on "Choose Folder..." but show custom display
                    selectElement.value = 'custom';
                    selectElement.dataset.customFolder = folder;
                    document.getElementById('custom-path-' + idx).textContent = folder;
                    document.getElementById('custom-path-' + idx).title = folder;
                    document.getElementById('custom-host-display-' + idx).style.display = 'flex';
                } else {
                    // Hide custom display if it was a standard option
                    document.getElementById('custom-host-display-' + idx).style.display = 'none';
                }
            }
        });

        document.getElementById('addBtn').addEventListener('click', () => {
          const items = [];
          document.querySelectorAll('.project-checkbox:checked').forEach(cb => {
             const idx = cb.id.replace('proj-', '');
             const path = cb.value;
             const role = document.getElementById('role-' + idx).value;
             let hostFolder = null;
             
             if (role === 'remote') {
                 const hostSelect = document.getElementById('host-' + idx);
                 if (hostSelect.value === 'custom') {
                     hostFolder = hostSelect.dataset.customFolder;
                 } else {
                     hostFolder = hostSelect.value;
                 }
             }
             
             items.push({ path, role, hostFolder });
          });
          
          vscode.postMessage({
            command: 'addSelectedFolders',
            items: items
          });
        });

        document.getElementById('skipBtn').addEventListener('click', () => {
          vscode.postMessage({ command: 'skipOnboarding' });
        });
      </script>
    </body>
    </html>`;
}

import * as vscode from 'vscode';
import * as path from 'path';
import {
    extractConfigFromWebpack,
    extractConfigFromVite,
    extractConfigFromModernJS,
    extractConfigFromRSBuild,
    parseConfigFile
} from './configExtractors';
import { ModuleFederationConfig } from './types';

export interface DetectedProject {
    path: string;
    name: string;
    configType: 'webpack' | 'vite' | 'modernjs' | 'rsbuild' | 'rspack';
    configPath: string;
    remotes: { name: string, url?: string }[];
}

/**
 * Scans the workspace for Module Federation configurations to power the onboarding experience.
 * Returns a deduplicated array of DetectedProject objects containing metadata.
 */
export async function detectModuleFederationProjects(): Promise<DetectedProject[]> {
    const detectedProjects: DetectedProject[] = [];
    const processedFolders = new Set<string>();

    const findAndAddProjects = async (files: vscode.Uri[], type: string, extractor: any) => {
        for (const file of files) {
            const dir = path.dirname(file.fsPath);
            if (processedFolders.has(dir)) continue;

            try {
                const config = await parseConfigFile(file.fsPath, extractor);

                if (!config.detected) {
                    continue;
                }

                detectedProjects.push({
                    path: dir,
                    name: config.name || path.basename(dir),
                    configType: type as any,
                    configPath: file.fsPath,
                    remotes: config.remotes.map(r => ({ name: r.name, url: r.url }))
                });
                processedFolders.add(dir);
            } catch (e) {
                // If parsing fails, we still add it but with minimal info if it matched our heuristic
                console.warn(`[MFE Explorer] Failed to fully parse ${file.fsPath}:`, e);
            }
        }
    };

    // 1. Explicit module-federation configuration files (ModernJS style)
    const explicitConfigs = await vscode.workspace.findFiles(
        '**/module-federation.config.{js,ts,cjs,mjs}',
        '**/node_modules/**'
    );
    await findAndAddProjects(explicitConfigs, 'modernjs', extractConfigFromModernJS);

    // 2. Implicit configs for different builders
    const webpackFiles = await vscode.workspace.findFiles('**/{webpack.config.js,webpack.config.ts}', '**/node_modules/**');
    await findAndAddProjects(webpackFiles, 'webpack', extractConfigFromWebpack);

    const viteFiles = await vscode.workspace.findFiles('**/{vite.config.js,vite.config.ts}', '**/node_modules/**');
    await findAndAddProjects(viteFiles, 'vite', extractConfigFromVite);

    const rsbuildFiles = await vscode.workspace.findFiles('**/{rsbuild.config.js,rsbuild.config.ts}', '**/node_modules/**');
    await findAndAddProjects(rsbuildFiles, 'rsbuild', extractConfigFromRSBuild);

    const rspackFiles = await vscode.workspace.findFiles('**/{rspack.config.js,rspack.config.ts}', '**/node_modules/**');
    // Rspack often uses webpack-compatible extractor
    await findAndAddProjects(rspackFiles, 'rspack', extractConfigFromWebpack);

    const modernFiles = await vscode.workspace.findFiles('**/{modern.config.js,modern.config.ts}', '**/node_modules/**');
    await findAndAddProjects(modernFiles, 'modernjs', extractConfigFromModernJS);

    return detectedProjects;
}


/** @deprecated Import parser and extractor modules directly. */
export { parseConfigFile, parseConfigText, ConfigParseError } from './parser/parseConfigFile';
export { extractConfigFromWebpack } from './extractors/webpack';
export { extractConfigFromVite } from './extractors/vite';
export { extractConfigFromModernJS } from './extractors/modernjs';
export { extractConfigFromRSBuild } from './extractors/rsbuild';

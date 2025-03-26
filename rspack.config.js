/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const path = require('path');

/**@type {import('@rspack/cli').Configuration}*/
const config = {
    target: 'node', // Rspack also supports Node.js context

    entry: './src/index.ts', // the entry point of this extension
    output: { // the bundle is stored in the 'dist' folder
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: "commonjs2",
    },
    devtool: 'source-map', // Rspack supports source maps
    externals: {
        vscode: "commonjs vscode", // Exclude vscode from the bundle
    },
    resolve: { // support reading TypeScript and JavaScript files
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{
                loader: 'ts-loader', // Rspack supports ts-loader
            }]
        }]
    },
}

module.exports = config;

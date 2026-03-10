'use strict';

const path = require('path');

/**@type {import('@rspack/cli').Configuration}*/
const config = {
    target: 'node',

    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: "commonjs2",
    },
    devtool: 'source-map',
    externals: {
        vscode: "commonjs vscode",
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            loader: 'builtin:swc-loader',
            options: {
                jsc: {
                    parser: {
                        syntax: 'typescript',
                    },
                },
            },
            type: 'javascript/auto',
        }]
    },
}

module.exports = config;

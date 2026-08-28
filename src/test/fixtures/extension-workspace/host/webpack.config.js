new ModuleFederationPlugin({
  name: 'fixture-host',
  remotes: {
    auth: 'auth@http://localhost:3001/remoteEntry.js'
  },
  exposes: {
    './App': './src/App.tsx'
  },
  shared: ['react']
});

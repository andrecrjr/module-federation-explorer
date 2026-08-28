new ModuleFederationPlugin({
  name: 'ui-onboarding-host',
  exposes: {
    './App': './src/App.tsx'
  }
});

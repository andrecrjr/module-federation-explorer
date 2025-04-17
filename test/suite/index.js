const path = require('path');
const Mocha = require('mocha');
const glob = require('glob');

function run() {
  // Create the mocha test with increased timeout
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 60000, // Increase default timeout to 60 seconds
    bail: false,    // Don't stop on first failure
    retries: 1      // Allow one retry for flaky tests
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((resolve, reject) => {
    try {
      // Use glob.sync instead of the callback version
      const files = glob.sync('**/**.test.js', { cwd: testsRoot });
      
      console.log(`Found ${files.length} test files:`, files);
      
      // Add files to the test suite
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

      // Run the mocha test
      mocha.run(failures => {
        if (failures > 0) {
          console.error(`${failures} tests failed.`);
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error('Error setting up test suite:', err);
      reject(err);
    }
  });
}

module.exports = { run }; 
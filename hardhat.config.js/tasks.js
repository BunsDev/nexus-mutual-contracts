const { task } = require('hardhat/config');

task('test', async (args, hre, runSuper) => {
  const testFiles = args.testFiles.length ? args.testFiles : ['test/index.js'];
  await runSuper({ ...args, testFiles });
});

task('test:setup-test-environment', async (_, hre) => {
  hre.accounts = await hre.web3.eth.getAccounts();
});

task('typechain', async (_, { config }) => {
  const { tsGenerator } = require('ts-generator');
  const { TypeChain } = require('typechain/dist/TypeChain');

  const cwd = process.cwd();
  const rawConfig = {
    files: `${config.paths.artifacts}/!(build-info|hardhat)/**/+([a-zA-Z0-9]).json`,
    outDir: 'types',
    target: 'truffle-v5',
  };

  await tsGenerator({ cwd }, new TypeChain({ cwd, rawConfig }));
});

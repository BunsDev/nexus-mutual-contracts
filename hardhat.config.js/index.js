require('dotenv').config();

require('@nomiclabs/hardhat-web3');
require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-waffle');
require('solidity-coverage');
require('hardhat-contract-sizer');

require('./tasks');

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
    disambiguatePaths: false,
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },

  mocha: {
    exit: true,
    bail: false,
    recursive: false,
    timeout: 0,
  },

  networks: require('./networks'),

  solidity: require('./solidity'),
};

if (process.env.ENABLE_TENDERLY) {
  const tenderly = require('@tenderly/hardhat-tenderly');
  tenderly.setup({ automaticVerifications: false });

  config.tenderly = {
    username: 'NexusMutual',
    project: 'nexusmutual',
    forkNetwork: 'mainnet',
    deploymentsDir: 'deployments',
    // privateVerification: false,
  };
}

module.exports = config;

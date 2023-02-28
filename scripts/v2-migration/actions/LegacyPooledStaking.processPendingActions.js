const { ethers } = require('hardhat');
const { runAction } = require('./utils');

async function action({ legacyPooledStaking, signer, opts }) {
  let hasPendingActions = await legacyPooledStaking.hasPendingActions();
  let i = 0;
  while (hasPendingActions) {
    console.log(`Calling processPendingActions(). iteration ${i++}`);
    const tx = await legacyPooledStaking.connect(signer).processPendingActions(100, {
      maxFeePerGas: opts.maxFeePerGas,
      maxPriorityFeePerGas: opts.maxPriorityFeePerGas,
      gasLimit: opts.gasLimit,
    });

    console.log(`Waiting tx to be mined: https://etherscan.io/tx/${tx.hash}`);
    await tx.wait();

    hasPendingActions = await this.pooledStaking.hasPendingActions();
    console.log(`Has pending actions: ${hasPendingActions}`);
  }

  console.log('Done');
}

const main = async () => {
  await runAction('LegacyStakingPool.processPendingActions', action);
};

if (require.main === module) {
  main(process.argv[1]).catch(e => {
    console.log('Unhandled error encountered: ', e.stack);
    process.exit(1);
  });
}

module.exports = action;

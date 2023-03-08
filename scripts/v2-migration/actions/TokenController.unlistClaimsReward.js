const { runAction } = require('./utils');

async function action({ tokenController, signer, opts = {} }) {
  const tx = await tokenController.connect(signer).unlistClaimsReward(opts);

  console.log(`Waiting tx to be mined: https://etherscan.io/tx/${tx.hash}`);
  await tx.wait();
  console.log('Done');
}

const main = async () => {
  await runAction('LegacyPooledStaking.blockV1', action);
};

if (require.main === module) {
  main(process.argv[1]).catch(e => {
    console.log('Unhandled error encountered: ', e.stack);
    process.exit(1);
  });
}

module.exports = action;
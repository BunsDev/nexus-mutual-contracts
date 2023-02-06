const { config, network, ethers } = require('hardhat');
const { BigNumber } = ethers;
const { AddressZero, MaxUint256 } = ethers.constants;
const { parseEther } = ethers.utils;

async function main() {
  console.log(`Using network: ${network.name}`);
  console.log('Network config:', config.networks[network.name]);

  const [owner] = await ethers.getSigners();
  console.log('OWNER ADDRESS', owner.address);

  const productId = 0;
  const payoutAsset = 0; // ETH
  const period = 3600 * 24 * 364; // 30 days
  const amount = parseEther('1');
  const targetPriceRatio = '260';
  const priceDenominator = '10000';
  const expectedPremium = amount.mul(targetPriceRatio).div(priceDenominator);

  const cover = await ethers.getContractAt('Cover', '0x4A679253410272dd5232B3Ff7cF5dbB88f295319');

  await cover.buyCover(
    {
      owner: '0x2546BcD3c84621e976D8185a91A922aE77ECEc30', // owner.address,
      productId,
      coverAsset: BigNumber.from('0'),
      amount,
      period,
      maxPremiumInAsset: expectedPremium,
      paymentAsset: payoutAsset,
      // payWitNXM: false,
      commissionRatio: parseEther('0'),
      commissionDestination: AddressZero,
      ipfsData: '',
      coverId: MaxUint256.toString(),
    },
    [{ poolId: 0, coverAmountInAsset: amount.toString() }],
    {
      value: expectedPremium,
    },
  );

  console.log('Bought a cover!');

  await cover.buyCover(
    {
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // owner.address,
      productId: 1,
      coverAsset: BigNumber.from('0'),
      amount,
      period,
      maxPremiumInAsset: expectedPremium,
      paymentAsset: payoutAsset,
      // payWitNXM: false,
      commissionRatio: parseEther('0'),
      commissionDestination: AddressZero,
      ipfsData: '',
      coverId: MaxUint256.toString(),
    },
    [{ poolId: '0', coverAmountInAsset: amount.toString() }],
    {
      value: expectedPremium,
    },
  );

  console.log('Bought a cover!');

  await cover.buyCover(
    {
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // owner.address,
      productId: 73, // custodian
      coverAsset: BigNumber.from('0'),
      amount,
      period,
      maxPremiumInAsset: expectedPremium,
      paymentAsset: payoutAsset,
      // payWitNXM: false,
      commissionRatio: parseEther('0'),
      commissionDestination: AddressZero,
      ipfsData: '',
      coverId: MaxUint256.toString(),
    },
    [{ poolId: '0', coverAmountInAsset: amount.toString() }],
    {
      value: expectedPremium,
    },
  );

  console.log('Bought a cover!');

  console.log('Done!');
  process.exit(0);
}

main().catch(error => {
  console.error('An unexpected error encountered:', error);
  process.exit(1);
});

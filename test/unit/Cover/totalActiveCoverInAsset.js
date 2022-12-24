const { ethers } = require('hardhat');
const { buyCoverOnOnePool } = require('./helpers');
const { expect } = require('chai');
const { parseEther } = ethers.utils;
const { setNextBlockTime } = require('../../utils/evm');
const { daysToSeconds } = require('../../../lib/helpers');

const NXM_ASSET_ID = 255;
describe('totalActiveCoverInAsset', function () {
  const ethCoverBuyFixture = {
    productId: 0,
    coverAsset: 0, // ETH
    period: daysToSeconds(30), // 30 days

    amount: parseEther('1000'),

    targetPriceRatio: '260',
    priceDenominator: '10000',
    activeCover: parseEther('8000'),
    capacity: parseEther('10000'),
    capacityFactor: '10000',
  };

  const daiCoverBuyFixture = {
    ...ethCoverBuyFixture,
    coverAsset: 1, // DAI
  };

  const nxmCoverBuyFixture = {
    ...ethCoverBuyFixture,
    payWithNXM: true,
    paymentAsset: NXM_ASSET_ID,
  };

  it('should compute active cover amount for ETH correctly after cover purchase', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;

    const { coverAsset, amount } = ethCoverBuyFixture;

    await buyCoverOnOnePool.call(this, ethCoverBuyFixture);

    const activeCoverAmount = await cover.totalActiveCoverInAsset(coverAsset);
    expect(activeCoverAmount).to.be.equal(amount);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    expect(await cover.getExpiredCoverAmount(coverAsset, currentBucketId - 1, currentBucketId + 1)).to.equal(0);
  });

  it('should compute active cover amount for DAI correctly after cover purchase', async function () {
    const { cover, dai } = this;
    const { BUCKET_SIZE } = this.config;

    const {
      members: [member1],
    } = this.accounts;

    const { coverAsset, amount } = daiCoverBuyFixture;

    await dai.mint(member1.address, parseEther('100000'));

    await dai.connect(member1).approve(cover.address, parseEther('100000'));

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);

    const activeCoverAmount = await cover.totalActiveCoverInAsset(coverAsset);
    expect(activeCoverAmount).to.be.equal(amount);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    expect(await cover.getExpiredCoverAmount(coverAsset, currentBucketId - 1, currentBucketId + 1)).to.equal(0);
    expect(await cover.lastBucketUpdateId()).to.be.equal(currentBucketId);
  });

  it('should compute active cover amount for NXM correctly after cover purchase', async function () {
    const { cover, nxm, tokenController } = this;
    const { BUCKET_SIZE } = this.config;

    const {
      members: [member1],
    } = this.accounts;

    const { coverAsset, amount } = nxmCoverBuyFixture;

    await nxm.mint(member1.address, parseEther('100000'));

    await nxm.connect(member1).approve(tokenController.address, parseEther('100000'));

    await buyCoverOnOnePool.call(this, nxmCoverBuyFixture);

    const activeCoverAmount = await cover.totalActiveCoverInAsset(coverAsset);
    expect(activeCoverAmount).to.be.equal(amount);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    expect(await cover.getExpiredCoverAmount(coverAsset, currentBucketId - 1, currentBucketId + 1)).to.equal(0);
    expect(await cover.lastBucketUpdateId()).to.be.equal(currentBucketId);
  });

  it('should decrease active cover amount when cover expires', async function () {
    const { cover, dai } = this;
    const { BUCKET_SIZE } = this.config;

    const {
      members: [member1],
    } = this.accounts;

    const { coverAsset, amount } = daiCoverBuyFixture;

    await dai.mint(member1.address, parseEther('200000'));

    await dai.connect(member1).approve(cover.address, parseEther('200000'));

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);
    {
      // Move forward cover.period + 1 bucket to expire cover
      const { timestamp } = await ethers.provider.getBlock('latest');
      await setNextBlockTime(BUCKET_SIZE.add(timestamp).add(daiCoverBuyFixture.period).toNumber());
    }

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);
    const activeCoverAmount = await cover.totalActiveCoverInAsset(coverAsset);
    expect(activeCoverAmount).to.be.equal(amount);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    const nextBucketId = Math.ceil(timestamp / BUCKET_SIZE);
    expect(await cover.getExpiredCoverAmount(coverAsset, currentBucketId, nextBucketId)).to.equal(amount);
    expect(await cover.lastBucketUpdateId()).to.be.equal(nextBucketId - 1);
  });
});

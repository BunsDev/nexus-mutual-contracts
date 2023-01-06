const { ethers } = require('hardhat');
const { buyCoverOnOnePool } = require('./helpers');
const { expect } = require('chai');
const { DAI_ASSET_ID } = require('../../integration/utils/cover');
const { BigNumber } = ethers;
const { parseEther } = ethers.utils;
const { AddressZero, MaxUint256 } = ethers.constants;
const { setNextBlockTime, mineNextBlock } = require('../../utils').evm;
const { daysToSeconds } = require('../../../lib/').helpers;

const ETH_COVER_ID = 0b0;
const DAI_COVER_ID = 0b1;
const USDC_COVER_ID = 0b10;

const ethCoverBuyFixture = {
  productId: 0,
  coverAsset: ETH_COVER_ID, // ETH
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
  coverAsset: DAI_COVER_ID,
  paymentAsset: DAI_COVER_ID,
};

describe('totalActiveCoverInAsset', function () {
  beforeEach(async function () {
    const { dai, cover } = this;
    const {
      members: [member1],
    } = this.accounts;

    await dai.mint(member1.address, parseEther('100000'));
    await dai.connect(member1).approve(cover.address, parseEther('100000'));
  });

  it('should compute active cover amount for ETH correctly after cover purchase', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;

    const { coverAsset, amount } = ethCoverBuyFixture;

    await buyCoverOnOnePool.call(this, ethCoverBuyFixture);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(coverAsset);
    expect(lastBucketUpdateId).to.equal(currentBucketId);
    expect(totalActiveCoverInAsset).to.equal(amount);
  });

  it('should compute active cover amount for DAI correctly after cover purchase', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;

    const { coverAsset, amount } = daiCoverBuyFixture;

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(coverAsset);
    expect(lastBucketUpdateId).to.equal(currentBucketId);
    expect(totalActiveCoverInAsset).to.equal(amount);
  });

  it('should compute active cover amount for NXM correctly after cover purchase', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;

    const { coverAsset, amount } = daiCoverBuyFixture;

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(coverAsset);
    expect(lastBucketUpdateId).to.be.equal(currentBucketId);
    expect(totalActiveCoverInAsset).to.be.equal(amount);
  });

  it('should initialize active cover tracking variables', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;
    const { timestamp: initialTimestamp } = await ethers.provider.getBlock('latest');
    const initialBucketId = Math.floor(initialTimestamp / BUCKET_SIZE);
    // ETH
    {
      const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(ETH_COVER_ID);
      expect(lastBucketUpdateId).to.be.equal(initialBucketId);
      expect(totalActiveCoverInAsset).to.be.equal(0);
    }
    // DAI
    {
      const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(DAI_ASSET_ID);
      expect(lastBucketUpdateId).to.be.equal(initialBucketId);
      expect(totalActiveCoverInAsset).to.be.equal(0);
    }
    // USDC
    {
      const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(USDC_COVER_ID);
      expect(lastBucketUpdateId).to.be.equal(initialBucketId);
      expect(totalActiveCoverInAsset).to.be.equal(0);
    }
  });

  it('should decrease active cover amount when cover expires', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;

    const { coverAsset, amount } = daiCoverBuyFixture;

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);
    {
      // Move forward cover.period + 1 bucket to expire cover
      const { timestamp } = await ethers.provider.getBlock('latest');
      await setNextBlockTime(BUCKET_SIZE.add(timestamp).add(daiCoverBuyFixture.period).toNumber());
    }

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);
    const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(coverAsset);
    expect(await lastBucketUpdateId).to.be.equal(currentBucketId);
    expect(totalActiveCoverInAsset).to.be.equal(amount);
  });

  it('should decrease active cover when an edited cover expires', async function () {
    const { cover } = this;
    const { BUCKET_SIZE } = this.config;
    const {
      members: [member1],
    } = this.accounts;

    const { amount, period, coverAsset, productId } = daiCoverBuyFixture;

    await buyCoverOnOnePool.call(this, daiCoverBuyFixture);

    {
      // Move forward 1 bucket
      const { timestamp } = await ethers.provider.getBlock('latest');
      await setNextBlockTime(BUCKET_SIZE.add(timestamp).toNumber());
    }

    // Edit cover
    await cover.connect(member1).buyCover(
      {
        owner: member1.address,
        coverId: 0,
        productId,
        coverAsset,
        amount,
        period,
        maxPremiumInAsset: amount,
        paymentAsset: coverAsset,
        commissionRatio: 0,
        commissionDestination: AddressZero,
        ipfsData: '',
      },
      [{ poolId: 0, coverAmountInAsset: amount }],
    );

    const { timestamp } = await ethers.provider.getBlock('latest');
    const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);

    const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(coverAsset);
    expect(lastBucketUpdateId).to.be.equal(currentBucketId);
    expect(totalActiveCoverInAsset).to.be.equal(amount);

    {
      // Move many blocks until next cover is purchased
      const { timestamp } = await ethers.provider.getBlock('latest');
      await setNextBlockTime(BigNumber.from(timestamp).add(daysToSeconds(500)).toNumber());
      await mineNextBlock();
      const amount = parseEther('50');
      await cover.connect(member1).buyCover(
        {
          owner: member1.address,
          coverId: MaxUint256,
          productId,
          coverAsset,
          amount,
          period,
          maxPremiumInAsset: amount,
          paymentAsset: coverAsset,
          commissionRatio: 0,
          commissionDestination: AddressZero,
          ipfsData: '',
        },
        [{ poolId: 0, coverAmountInAsset: amount }],
      );
    }

    {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const currentBucketId = Math.floor(timestamp / BUCKET_SIZE);

      const { lastBucketUpdateId, totalActiveCoverInAsset } = await cover.activeCover(coverAsset);
      expect(lastBucketUpdateId).to.be.equal(currentBucketId);
      expect(totalActiveCoverInAsset).to.be.equal(parseEther('50'));
    }
  });
});

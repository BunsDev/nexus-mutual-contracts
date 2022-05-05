const { assert, expect } = require('chai');
const { ethers: { utils: { parseEther } } } = require('hardhat');
const { time, constants: { ZERO_ADDRESS } } = require('@openzeppelin/test-helpers');
const { createStakingPool, assertCoverFields, buyCoverOnOnePool, MAX_COVER_PERIOD } = require('./helpers');

describe('editCover', function () {

  const coverBuyFixture = {
    productId: 0,
    payoutAsset: 0, // ETH
    period: 3600 * 24 * 30, // 30 days

    amount: parseEther('1000'),

    targetPriceRatio: '260',
    priceDenominator: '10000',
    activeCover: parseEther('5000'),
    capacity: parseEther('10000'),
    capacityFactor: '10000',
  };

  it('should edit purchased cover and increase amount', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      period,
      amount,
      priceDenominator,
      targetPriceRatio
    } = coverBuyFixture;

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const increasedAmount = amount.mul(2);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);

    const expectedEditPremium = expectedPremium.mul(2);
    const extraPremium = expectedEditPremium.sub(expectedRefund);

    const tx = await cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount: increasedAmount,
        period,
        maxPremiumInAsset: expectedEditPremium.add(1),
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: parseEther('0'),
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: increasedAmount.toString() }],
      {
        value: extraPremium.add(1),
      },
    );
    const receipt = await tx.wait();

    console.log({
      gasUsed: receipt.gasUsed.toString(),
    });

    await assertCoverFields(cover, expectedCoverId,
      { productId, payoutAsset, period: period, amount: increasedAmount, targetPriceRatio, segmentId: '1' },
    );
  });

  it('should edit purchased cover and increase period', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      period,
      amount,
      targetPriceRatio,
      priceDenominator,
    } = coverBuyFixture;

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);

    const expectedEditPremium = expectedPremium.mul(2);
    const extraPremium = expectedEditPremium.sub(expectedRefund);
    const increasedPeriod = period * 2;

    const tx = await cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount,
        period: increasedPeriod,
        maxPremiumInAsset: expectedEditPremium.add(10),
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: parseEther('0'),
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: amount.toString() }],
      {
        value: extraPremium.add(10),
      },
    );

    const receipt = await tx.wait();

    console.log({
      gasUsed: receipt.gasUsed.toString(),
    });

    await assertCoverFields(cover, expectedCoverId,
      { productId, payoutAsset, period: increasedPeriod, amount: amount, targetPriceRatio, segmentId: '1' },
    );
  });

  it('should edit purchased cover and increase period and amount', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      period,
      amount,
      targetPriceRatio,
      priceDenominator,
    } = coverBuyFixture;

    await buyCoverOnOnePool.call(this, coverBuyFixture);

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);

    const expectedEditPremium = expectedPremium.mul(4);
    const extraPremium = expectedEditPremium.sub(expectedRefund);
    const increasedAmount = amount.mul(2);
    const increasedPeriod = period * 2;

    const tx = await cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount: increasedAmount,
        period: increasedPeriod,
        maxPremiumInAsset: expectedEditPremium.add(10),
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: parseEther('0'),
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: increasedAmount.toString() }],
      {
        value: extraPremium.add(10),
      },
    );

    const receipt = await tx.wait();

    console.log({
      gasUsed: receipt.gasUsed.toString(),
    });

    await assertCoverFields(cover, expectedCoverId,
      { productId, payoutAsset, period: increasedPeriod, amount: increasedAmount, targetPriceRatio, segmentId: '1' },
    );
  });

  it('should edit purchased cover and increase period and decrease amount', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      period,
      amount,
      targetPriceRatio,
      priceDenominator,
    } = coverBuyFixture;

    await buyCoverOnOnePool.call(this, coverBuyFixture);

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);

    const expectedEditPremium = expectedPremium;
    const extraPremium = expectedEditPremium.sub(expectedRefund);
    const decreasedAmount = amount.div(2);
    const increasedPeriod = period * 2;

    const tx = await cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount: decreasedAmount,
        period: increasedPeriod,
        maxPremiumInAsset: expectedEditPremium,
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: parseEther('0'),
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: decreasedAmount.toString() }],
      {
        value: extraPremium,
      },
    );

    const receipt = await tx.wait();

    console.log({
      gasUsed: receipt.gasUsed.toString(),
    });

    await assertCoverFields(cover, expectedCoverId,
      { productId, payoutAsset, period: increasedPeriod, amount: decreasedAmount, targetPriceRatio, segmentId: '1' },
    );
  });

  it('should revert when cover is expired', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      period,
      amount,
      targetPriceRatio,
      priceDenominator,
    } = coverBuyFixture;

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);
    const increasedAmount = amount.mul(2);
    const expectedEditPremium = expectedPremium.mul(2);
    const extraPremium = expectedEditPremium.sub(expectedRefund);
    // make cover expire
    await time.increase(period + 3600);

    await expect(cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount: increasedAmount,
        period,
        maxPremiumInAsset: expectedEditPremium,
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: parseEther('0'),
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: increasedAmount.toString() }],
      {
        value: extraPremium,
      },
    )).to.be.revertedWith('Cover: cover expired');
  });

  it('should revert when period is too long', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      amount,
      targetPriceRatio,
      priceDenominator,
    } = coverBuyFixture;

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);
    const increasedAmount = amount.mul(2);
    const expectedEditPremium = expectedPremium.mul(2);
    const extraPremium = expectedEditPremium.sub(expectedRefund);

    const periodTooLong = 366 * 24 * 3600; // 366 days

    await expect(cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount: increasedAmount,
        period: periodTooLong,
        maxPremiumInAsset: expectedEditPremium,
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: parseEther('0'),
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: increasedAmount.toString() }],
      {
        value: extraPremium,
      })).to.be.revertedWith('Cover: Cover period is too long');
  });

  it('should revert when commission rate too high', async function () {
    const { cover } = this;

    const {
      members: [member1],
      members: [coverBuyer1],
    } = this.accounts;

    const {
      productId,
      payoutAsset,
      amount,
      period,
      priceDenominator
    } = coverBuyFixture;

    await buyCoverOnOnePool.call(this, coverBuyFixture);

    const { expectedPremium, segment, coverId: expectedCoverId } = await buyCoverOnOnePool.call(this, coverBuyFixture);

    const expectedRefund = segment.amount.mul(segment.priceRatio).mul(segment.period).div(MAX_COVER_PERIOD).div(priceDenominator);
    const increasedAmount = amount.mul(2);
    const expectedEditPremium = expectedPremium.mul(2);
    const extraPremium = expectedEditPremium.sub(expectedRefund);

    await expect(cover.connect(member1).editCover(
      expectedCoverId,
      {
        owner: coverBuyer1.address,
        productId,
        payoutAsset,
        amount: increasedAmount,
        period,
        maxPremiumInAsset: expectedEditPremium,
        paymentAsset: payoutAsset,
        payWitNXM: false,
        commissionRatio: '2600', // too high
        commissionDestination: ZERO_ADDRESS,
      },
      [{ poolId: '0', coverAmountInAsset: increasedAmount.toString() }],
      {
        value: extraPremium,
      },
    )).to.be.revertedWith('Cover: Commission rate is too high');
  });
});

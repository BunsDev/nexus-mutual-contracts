const { expect } = require('chai');
const { ethers } = require('hardhat');
const { getCurrentTrancheId } = require('../StakingPool/helpers');
const { BigNumber } = ethers;
const daysToSeconds = days => days * 24 * 60 * 60;

async function verifyProduct(params) {
  const { cover } = this;
  let { product, productParams } = params;

  const { _initialPrices } = await cover.getPriceAndCapacityRatios([productParams.productId]);

  if (!productParams.bumpedPriceUpdateTime) {
    const { timestamp } = await ethers.provider.getBlock('latest');
    productParams = { ...productParams, bumpedPriceUpdateTime: timestamp };
  }

  expect(product.targetWeight).to.be.equal(productParams.targetWeight);
  expect(product.targetPrice).to.be.equal(productParams.targetPrice);

  expect(product.bumpedPriceUpdateTime).to.be.equal(productParams.bumpedPriceUpdateTime);
  expect(product.bumpedPrice).to.be.equal(_initialPrices[0]);
}

async function verifyInitialProduct(params) {
  let { product, initialProduct } = params;

  if (!initialProduct.bumpedPriceUpdateTime) {
    const { timestamp } = await ethers.provider.getBlock('latest');
    initialProduct = { ...initialProduct, bumpedPriceUpdateTime: timestamp };
  }

  expect(product.targetWeight).to.be.equal(initialProduct.weight);
  expect(product.targetPrice).to.be.equal(initialProduct.targetPrice);
  expect(product.bumpedPriceUpdateTime).to.be.equal(initialProduct.bumpedPriceUpdateTime);
  expect(product.bumpedPrice).to.be.equal(initialProduct.initialPrice);
}

async function depositTo(params) {
  const { stakingPool, nxm, tokenController } = this;
  const { staker, amount } = params;

  // Get capacity in staking pool
  await nxm.mint(staker.address, BigNumber.from(2).pow(128));
  await nxm.connect(staker).approve(tokenController.address, amount);
  const trancheId = (await getCurrentTrancheId()) + 2;
  await stakingPool.connect(staker).depositTo(amount, trancheId, /* token id: */ 0, staker.address);
}

module.exports = { daysToSeconds, verifyProduct, verifyInitialProduct, depositTo };

const { assert } = require('chai');
const { web3, ethers } = require('hardhat');
const { ether, time, expectRevert } = require('@openzeppelin/test-helpers');
const { hex } = require('../utils').helpers;

const accounts = require('../utils').accounts;
const { calculatePrice, toDecimal } = require('./helpers');

const { toBN } = web3.utils;

describe('interpolatePrice', function () {

  it('should interpolate price correctly based on time elapsed when price is decreasing', async function () {
    const { stakingPool } = this;

    const lastPrice = '1000';
    const targetPrice = '500';
    const lastPriceUpdate = '0';
    const now = (24 * 3600).toString();

    const price = await stakingPool.interpolatePrice(
      lastPrice,
      targetPrice,
      lastPriceUpdate,
      now,
    );

    const expectedPrice = toDecimal(lastPrice).sub(toDecimal(lastPrice).sub(toDecimal(targetPrice)).div(100));

    assert.equal(price.toString(), expectedPrice.toString());
  });

  it('should set price to target price when price is increasing', async function () {
    const { stakingPool } = this;

    const lastPrice = '500';
    const targetPrice = '1000';
    const lastPriceUpdate = '0';
    const now = (24 * 3600).toString();

    const price = await stakingPool.interpolatePrice(
      lastPrice,
      targetPrice,
      lastPriceUpdate,
      now,
    );

    assert.equal(price.toString(), targetPrice.toString());
  });

});

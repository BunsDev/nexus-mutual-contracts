const { ether } = require('@openzeppelin/test-helpers');
const { expectRevert } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');

const {
  governanceContracts: [governance],
  generalPurpose: [destination, arbitraryCaller],
} = require('../utils').accounts;

const ERC20Mock = artifacts.require('ERC20Mock');

describe('transferAsset', function () {
  it('transfers added ERC20 asset to destination', async function () {
    const { pool } = this;

    const tokenAmount = ether('100000');
    const otherToken = await ERC20Mock.new();
    await pool.addAsset(otherToken.address, 18, '0', '0', 100 /* 1% */, true, {
      from: governance,
    });
    await otherToken.mint(pool.address, tokenAmount);

    const amountToTransfer = tokenAmount.divn(2);

    await pool.transferAsset(otherToken.address, destination, amountToTransfer, { from: governance });
    const destinationBalance = await otherToken.balanceOf(destination);
    assert.equal(destinationBalance.toString(), amountToTransfer.toString());

    const poolBalance = await otherToken.balanceOf(pool.address);
    assert.equal(poolBalance.toString(), tokenAmount.sub(amountToTransfer).toString());
  });

  it('transfers arbitrary ERC20 asset in the Pool to destination', async function () {
    const { pool } = this;

    const tokenAmount = ether('100000');
    const otherToken = await ERC20Mock.new();
    await otherToken.mint(pool.address, tokenAmount);

    const amountToTransfer = tokenAmount.divn(2);

    await pool.transferAsset(otherToken.address, destination, amountToTransfer, { from: governance });
    const destinationBalance = await otherToken.balanceOf(destination);
    assert.equal(destinationBalance.toString(), amountToTransfer.toString());

    const poolBalance = await otherToken.balanceOf(pool.address);
    assert.equal(poolBalance.toString(), tokenAmount.sub(amountToTransfer).toString());
  });

  it('transfers entire balance of arbitrary ERC20 asset in the Pool if amount < balance', async function () {
    const { pool } = this;

    const tokenAmount = ether('100000');
    const otherToken = await ERC20Mock.new();

    await otherToken.mint(pool.address, tokenAmount);
    const amountToTransfer = tokenAmount.addn(1);

    await pool.transferAsset(otherToken.address, destination, amountToTransfer, { from: governance });

    const destinationBalance = await otherToken.balanceOf(destination);
    assert.equal(destinationBalance.toString(), tokenAmount.toString());

    const poolBalance = await otherToken.balanceOf(pool.address);
    assert.equal(poolBalance.toString(), '0');
  });

  it('reverts on asset transfer if asset maxAmount > 0', async function () {
    const { pool } = this;

    const tokenAmount = ether('100000');
    const otherToken = await ERC20Mock.new();
    await pool.addAsset(otherToken.address, 18, '0', '1', 100 /* 1% */, true, {
      from: governance,
    });
    await otherToken.mint(pool.address, tokenAmount);
    await expectRevert(
      pool.transferAsset(otherToken.address, destination, tokenAmount, { from: governance }),
      'Pool: Max not zero',
    );
  });

  it('reverts on asset transfer if caller is not authorized to govern', async function () {
    const { pool } = this;

    const tokenAmount = ether('100000');
    const otherToken = await ERC20Mock.new();
    await otherToken.mint(pool.address, tokenAmount);
    await expectRevert(
      pool.transferAsset(otherToken.address, destination, tokenAmount, { from: arbitraryCaller }),
      'Caller is not authorized to govern',
    );
  });
});

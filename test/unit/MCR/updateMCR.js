const { assert } = require('chai');
const { web3 } = require('hardhat');
const { ether, time } = require('@openzeppelin/test-helpers');
const { initMCR } = require('./common');
const { toBN } = web3.utils;

const DEFAULT_MCR_PARAMS = {
  mcrValue: ether('150000'),
  mcrFloor: ether('150000'),
  desiredMCR: ether('150000'),
  mcrFloorIncrementThreshold: '13000',
  maxMCRFloorIncrement: '100',
  maxMCRIncrement: '500',
  gearingFactor: '48000',
  minUpdateTime: '3600',
};

const ratioScale = toBN(10000);

describe('updateMCR', function () {
  it('does not update if minUpdateTime has not passed', async function () {
    const { master, pool } = this;

    const poolValueInEth = ether('200000');
    await pool.setPoolValueInEth(poolValueInEth);
    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });

    const previousLastUpdateTime = await mcr.lastUpdateTime();

    await mcr.updateMCR();

    const storedMCR = await mcr.mcr();
    const desiredMCR = await mcr.desiredMCR();
    const lastUpdateTime = await mcr.lastUpdateTime();

    assert(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
    assert(desiredMCR.toString(), DEFAULT_MCR_PARAMS.desiredMCR.toString());
    assert(lastUpdateTime.toString(), previousLastUpdateTime.toString());
  });

  it('keeps values the same if MCR = MCR floor and mcrWithGear is too low', async function () {
    const { master, cover, pool } = this;

    await pool.setPoolValueInEth(ether('160000'));
    await cover.setTotalActiveCoverInAsset(0, '100000');

    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });
    const minUpdateTime = await mcr.minUpdateTime();
    await time.increase(minUpdateTime.addn(1));

    const tx = await mcr.updateMCR();
    const block = await web3.eth.getBlock(tx.receipt.blockNumber);

    const storedMCR = await mcr.mcr();
    const desiredMCR = await mcr.desiredMCR();
    const lastUpdateTime = await mcr.lastUpdateTime();

    assert.equal(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
    assert.equal(desiredMCR.toString(), DEFAULT_MCR_PARAMS.desiredMCR.toString());
    assert.equal(lastUpdateTime.toString(), block.timestamp.toString());
  });

  it('increases desiredMCR when mcrWithGear exceeds current MCR', async function () {
    const { master, cover, pool } = this;

    await pool.setPoolValueInEth(ether('160000'));
    await cover.setTotalActiveCoverInAsset(0, ether('800000'));

    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });
    const minUpdateTime = await mcr.minUpdateTime();
    await time.increase(minUpdateTime.addn(1));

    const tx = await mcr.updateMCR();
    const block = await web3.eth.getBlock(tx.receipt.blockNumber);

    const storedMCR = await mcr.mcr();
    const desiredMCR = await mcr.desiredMCR();
    const lastUpdateTime = await mcr.lastUpdateTime();

    const totalSumAssured = await mcr.getAllSumAssurance();
    const gearingFactor = await mcr.gearingFactor();
    const expectedDesiredMCR = totalSumAssured.muln(10000).div(gearingFactor);

    assert.equal(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
    assert.equal(desiredMCR.toString(), expectedDesiredMCR.toString());
    assert.equal(lastUpdateTime.toString(), block.timestamp.toString());
  });

  it('increases desiredMCR when mcrFloor increases (MCR% > 130%)', async function () {
    const { master, cover, pool } = this;

    const poolValueInEth = DEFAULT_MCR_PARAMS.mcrValue.muln(131).divn(100);
    await pool.setPoolValueInEth(poolValueInEth);
    await cover.setTotalActiveCoverInAsset(0, ether('100000'));

    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });
    await time.increase(time.duration.days(1));

    const tx = await mcr.updateMCR();
    const block = await web3.eth.getBlock(tx.receipt.blockNumber);

    const storedMCR = await mcr.mcr();
    const desiredMCR = await mcr.desiredMCR();
    const mcrFloor = await mcr.mcrFloor();
    const lastUpdateTime = await mcr.lastUpdateTime();
    const expectedMCRFloor = DEFAULT_MCR_PARAMS.mcrFloor.muln(101).divn(100);

    assert.equal(mcrFloor.toString(), expectedMCRFloor.toString());
    assert.equal(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
    assert.equal(desiredMCR.toString(), mcrFloor.toString());
    assert.equal(lastUpdateTime.toString(), block.timestamp.toString());
  });

  it.skip('increases desiredMCR when both mcrFloor and mcrWithGear increase', async function () {
    const { master, cover, pool } = this;

    const poolValueInEth = DEFAULT_MCR_PARAMS.mcrValue.muln(131).divn(100);
    await pool.setPoolValueInEth(poolValueInEth);

    const totalSumAssured = toBN('800000');
    await cover.setTotalActiveCoverInAsset(0, totalSumAssured);

    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });
    const gearingFactor = await mcr.gearingFactor();

    await time.increase(time.duration.days(1));
    const tx = await mcr.updateMCR();
    const block = await web3.eth.getBlock(tx.receipt.blockNumber);

    const storedMCR = await mcr.mcr();
    const desiredMCR = await mcr.desiredMCR();
    const mcrFloor = await mcr.mcrFloor();
    const lastUpdateTime = await mcr.lastUpdateTime();

    const expectedMCRFloor = DEFAULT_MCR_PARAMS.mcrFloor.muln(101).divn(100);
    const expectedDesiredMCR = ether(totalSumAssured.toString()).muln(10000).div(gearingFactor);
    assert.equal(mcrFloor.toString(), expectedMCRFloor.toString());
    assert.equal(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
    assert.equal(desiredMCR.toString(), expectedDesiredMCR.toString());
    assert.equal(lastUpdateTime.toString(), block.timestamp.toString());
  });

  it.skip('increases/decreases desiredMCR when mcrWithGear increases/decreases', async function () {
    const { master, cover, pool } = this;

    const poolValueInEth = ether('160000');
    await pool.setPoolValueInEth(poolValueInEth);
    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });

    const gearingFactor = await mcr.gearingFactor();
    const minUpdateTime = await mcr.minUpdateTime();
    {
      const totalSumAssured = toBN('900000');
      await cover.setTotalActiveCoverInAsset(0, totalSumAssured);
      await time.increase(minUpdateTime.addn(1));

      await mcr.updateMCR();
      const storedMCR = await mcr.mcr();
      const desiredMCR = await mcr.desiredMCR();
      const expectedDesiredMCR = ether(totalSumAssured.toString()).muln(10000).div(gearingFactor);

      assert.equal(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
      assert.equal(desiredMCR.toString(), expectedDesiredMCR.toString());
    }

    {
      const totalSumAssured = toBN('800000');
      await cover.setTotalActiveCoverInAsset(0, totalSumAssured);
      await time.increase(minUpdateTime.addn(1));

      await mcr.updateMCR();
      const desiredMCR = await mcr.desiredMCR();
      const expectedDesiredMCR = ether(totalSumAssured.toString()).muln(10000).div(gearingFactor);
      assert.equal(desiredMCR.toString(), expectedDesiredMCR.toString());
    }
  });

  it.skip('increases desiredMCR when mcrWithGear increases and then decreases down to mcrFloor', async function () {
    const { master, cover, pool } = this;

    const poolValueInEth = ether('160000');
    await pool.setPoolValueInEth(poolValueInEth);
    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });

    const gearingFactor = await mcr.gearingFactor();
    const minUpdateTime = await mcr.minUpdateTime();
    {
      const totalSumAssured = toBN('900000');
      await cover.setTotalActiveCoverInAsset(0, totalSumAssured);
      await time.increase(minUpdateTime.addn(1));

      await mcr.updateMCR();
      const storedMCR = await mcr.mcr();
      const desiredMCR = await mcr.desiredMCR();
      const expectedDesiredMCR = ether(totalSumAssured.toString()).muln(10000).div(gearingFactor);

      assert.equal(storedMCR.toString(), DEFAULT_MCR_PARAMS.mcrValue.toString());
      assert.equal(desiredMCR.toString(), expectedDesiredMCR.toString());
    }

    {
      const totalSumAssured = toBN('700000');
      await cover.setTotalActiveCoverInAsset(0, totalSumAssured);
      await time.increase(minUpdateTime.addn(1));

      await mcr.updateMCR();
      const desiredMCR = await mcr.desiredMCR();
      assert.equal(desiredMCR.toString(), DEFAULT_MCR_PARAMS.mcrFloor.toString());
    }
  });

  it('increases mcrFloor by 1% after 2 days pass', async function () {
    const { master, pool } = this;

    const poolValueInEth = ether('200000');
    await pool.setPoolValueInEth(poolValueInEth);
    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });

    const maxMCRFloorIncrement = await mcr.maxMCRFloorIncrement();

    const previousMCRFloor = await mcr.mcrFloor();
    await time.increase(time.duration.days(2));
    await mcr.updateMCR();

    const currentMCRFloor = await mcr.mcrFloor();

    const expectedMCRFloor = previousMCRFloor.mul(ratioScale.add(maxMCRFloorIncrement)).divn(ratioScale);
    assert.equal(currentMCRFloor.toString(), expectedMCRFloor.toString());
  });

  it('increases mcrFloor by 1% on multiple updates that are 2 days apart', async function () {
    const { master, pool } = this;

    const poolValueInEth = ether('200000');
    await pool.setPoolValueInEth(poolValueInEth);
    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });

    const maxMCRFloorIncrement = await mcr.maxMCRFloorIncrement();
    {
      const previousMCRFloor = await mcr.mcrFloor();
      await time.increase(time.duration.days(2));
      await mcr.updateMCR();

      const currentMCRFloor = await mcr.mcrFloor();

      const expectedMCRFloor = previousMCRFloor.mul(ratioScale.add(maxMCRFloorIncrement)).divn(ratioScale);
      assert.equal(currentMCRFloor.toString(), expectedMCRFloor.toString());
    }

    {
      const previousMCRFloor = await mcr.mcrFloor();
      await time.increase(time.duration.days(2));
      await mcr.updateMCR();

      const currentMCRFloor = await mcr.mcrFloor();

      const expectedMCRFloor = previousMCRFloor.mul(ratioScale.add(maxMCRFloorIncrement)).divn(ratioScale);
      assert.equal(currentMCRFloor.toString(), expectedMCRFloor.toString());
    }
  });

  it('increases desiredMCR when mcrWithGear exceeds current MCR if MCR% < 100%', async function () {
    const { master, cover, pool } = this;
    await pool.setPoolValueInEth(ether('120000'));
    await cover.setTotalActiveCoverInAsset(0, ether('800000'));

    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, master });
    const minUpdateTime = await mcr.minUpdateTime();
    await time.increase(minUpdateTime.addn(1));
    await mcr.updateMCR();

    const desiredMCR = await mcr.desiredMCR();
    const totalSumAssured = await mcr.getAllSumAssurance();
    const gearingFactor = await mcr.gearingFactor();
    const expectedDesiredMCR = totalSumAssured.muln(10000).div(gearingFactor);
    assert.equal(desiredMCR.toString(), expectedDesiredMCR.toString());
  });

  it('decreases desiredMCR towards mcrFloor when poolValueInEth = 0 and totalSumAssured = 0', async function () {
    const { master, pool } = this;

    const poolValueInEth = ether('120000');
    await pool.setPoolValueInEth(poolValueInEth);
    const mcr = await initMCR({ ...DEFAULT_MCR_PARAMS, desiredMCR: ether('160000'), master });

    const minUpdateTime = await mcr.minUpdateTime();
    await time.increase(minUpdateTime.addn(1));

    await mcr.updateMCR();

    const desiredMCR = await mcr.desiredMCR();

    assert.equal(desiredMCR.toString(), DEFAULT_MCR_PARAMS.mcrFloor.toString());
  });
});

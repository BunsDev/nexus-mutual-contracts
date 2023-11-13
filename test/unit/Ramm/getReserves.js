const { ethers } = require('hardhat');
const { expect } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const { setup, SPOT_PRICE_A, SPOT_PRICE_B } = require('./setup');
const { calculateEthToExtract, calculateEthToInject } = require('./helpers');

const { BigNumber } = ethers;
const { parseEther } = ethers.utils;

/**
 * Removes the '0x' prefix from a hexadecimal string if it exists.
 *
 * @param {string} hex - The hexadecimal string from which the prefix needs to be removed
 * @returns {string} - The modified hexadecimal string without the '0x' prefix
 */
const removeHexPrefix = hex => (hex.startsWith('0x') ? hex.slice(2) : hex);

const INITIAL_LIQUIDITY = parseEther('5000');
const FAST_RATCHET_SPEED = 5000;
const INITIAL_BUDGET = parseEther('43835');

const INITIAL_RAMM_STATE = {
  nxmA: INITIAL_LIQUIDITY.mul(parseEther('1')).div(SPOT_PRICE_A),
  nxmB: INITIAL_LIQUIDITY.mul(parseEther('1')).div(SPOT_PRICE_B),
  eth: INITIAL_LIQUIDITY,
  budget: INITIAL_BUDGET,
  ratchetSpeed: FAST_RATCHET_SPEED,
};

/**
 * Replaces a bit value in a hexadecimal string with a new value at a specific bit position.
 *
 * @param {string} origHex - The original hexadecimal string (must be 256 bits / 64 hex characters)
 * @param {string} newHexValue - The new hexadecimal value to replace with
 * @param {number} bitPosition - The position of the bit in the original string to replace
 * @return {string} The modified hexadecimal string
 */
const replaceHexValueInBitPos = (origHex, newHexValue, bitPosition) => {
  // Convert hex to buffers
  const bufferOrig = Buffer.from(removeHexPrefix(origHex), 'hex');
  const bufferNewVal = Buffer.from(removeHexPrefix(newHexValue), 'hex');

  // Calculate the correct byte start position and copy the new value into the original buffer
  const byteStart = origHex.length / 2 - bitPosition / 8;
  bufferNewVal.copy(bufferOrig, byteStart);

  return '0x' + bufferOrig.toString('hex');
};

/**
 * Sets the value of the Ether reserve in the RAMM contract.
 *
 * @async
 * @param {string} rammAddress - The address of the RAMM contract
 * @param {number} valueInEther - The value of the Ether reserve in Ether
 * @return {Promise<void>}
 */
const setEthReserveValue = async (rammAddress, valueInEther) => {
  const SLOT_1_POSITION = '0x3';
  // Convert valueInEther to 128 bits wei hex value
  const hexValueInWei = parseEther(valueInEther.toString()).toHexString();
  const newEtherReserve = '0x' + removeHexPrefix(hexValueInWei).padStart(32, '0'); // 32 hex chars in 128 bits
  // Get current Slot1 value
  const slot1Value = await ethers.provider.send('eth_getStorageAt', [rammAddress, SLOT_1_POSITION]);
  // Update Slot1 to have new ethReserve value
  const newSlot1Value = await replaceHexValueInBitPos(slot1Value, newEtherReserve, 128);
  return ethers.provider.send('hardhat_setStorageAt', [rammAddress, SLOT_1_POSITION, newSlot1Value]);
};

/**
 * Calculates the expected NxmA ratcheted value
 *
 * @param {Object} state - The current RAMM state
 * @param {BigNumber} eth - The current ETH reserve
 * @param {BigNumber} capital - The current pool capital value in ETH
 * @param {BigNumber} supply - The current total NXM supply
 * @param {number} blockTimestamp - The current block timestamp
 * @param {Object} constants - The constants object
 * @return {BigNumber} The expected NxmA ratcheted value
 */
const getExpectedNxmARatchet = (
  state,
  eth,
  capital,
  supply,
  blockTimestamp,
  { RATCHET_PERIOD, RATCHET_DENOMINATOR },
) => {
  const elapsed = blockTimestamp - state.timestamp;
  const nrDenomAddendA = state.nxmA
    .mul(elapsed)
    .mul(state.ratchetSpeed)
    .mul(capital)
    .div(supply)
    .div(RATCHET_PERIOD)
    .div(RATCHET_DENOMINATOR);
  return eth.mul(state.nxmA).div(eth.sub(nrDenomAddendA));
};

/**
 * Calculates the expected NxmB ratcheted value
 *
 * @param {Object} state - The current RAMM state
 * @param {BigNumber} eth - The current ETH reserve
 * @param {BigNumber} capital - The current pool capital value in ETH
 * @param {BigNumber} supply - The current total NXM supply
 * @param {number} blockTimestamp - The current block timestamp
 * @param {Object} constants - The constants object
 * @return {BigNumber} The expected NxmB ratcheted value
 */
const getExpectedNxmBRatchet = (
  state,
  eth,
  capital,
  supply,
  blockTimestamp,
  { RATCHET_PERIOD, RATCHET_DENOMINATOR },
) => {
  const elapsed = blockTimestamp - state.timestamp;
  const nrDenomAddendB = state.nxmB
    .mul(elapsed)
    .mul(state.ratchetSpeed)
    .mul(capital)
    .div(supply)
    .div(RATCHET_PERIOD)
    .div(RATCHET_DENOMINATOR);
  return eth.mul(state.nxmB).div(eth.add(nrDenomAddendB));
};

/**
 * Calculates the expected NxmA book value.
 *
 * @param {BigNumber} eth - The current ETH liquidity
 * @param {BigNumber} capital - The current pool capital value in ETH
 * @param {BigNumber} supply - The current total NXM supply
 * @param {Object} constants - The constants object
 * @return {BigNumber} The expected NxmA book value
 */
const getExpectedNxmABookValue = (eth, capital, supply, { PRICE_BUFFER_DENOMINATOR, PRICE_BUFFER }) => {
  const bufferedCapitalA = capital.mul(PRICE_BUFFER_DENOMINATOR.add(PRICE_BUFFER)).div(PRICE_BUFFER_DENOMINATOR);
  return eth.mul(supply).div(bufferedCapitalA);
};

/**
 * Calculates the expected NxmB book value.
 *
 * @param {BigNumber} eth - The current ETH liquidity
 * @param {BigNumber} capital - The current pool capital value in ETH
 * @param {BigNumber} supply - The current total NXM supply
 * @param {Object} constants - The constants object
 * @return {BigNumber} The expected NxmB book value
 */
const getExpectedNxmBBookValue = (eth, capital, supply, { PRICE_BUFFER_DENOMINATOR, PRICE_BUFFER }) => {
  const bufferedCapitalB = capital.mul(PRICE_BUFFER_DENOMINATOR.sub(PRICE_BUFFER)).div(PRICE_BUFFER_DENOMINATOR);
  return eth.mul(supply).div(bufferedCapitalB);
};

describe('getReserves', function () {
  it('should return the current state in the pools correctly - Ratcheted value', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController } = fixture.contracts;

    // Set ethReserve so it doesn't get to the book value (i.e. use ratchet)
    await setEthReserveValue(ramm.address, 500);

    const state = await ramm.loadState();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const { timestamp } = await ethers.provider.getBlock('latest');

    const { _ethReserve, nxmA, nxmB, _budget } = await ramm.getReserves();

    const expectedEthToExtract = calculateEthToExtract(state, timestamp, fixture.constants);
    const expectedEth = state.eth.sub(expectedEthToExtract);
    const expectedNxmA = getExpectedNxmARatchet(state, _ethReserve, capital, supply, timestamp, fixture.constants);
    const expectedNxmB = getExpectedNxmBRatchet(state, _ethReserve, capital, supply, timestamp, fixture.constants);
    const expectedBudget = state.budget;

    expect(_ethReserve).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(_budget).to.be.equal(expectedBudget);
  });
});

describe('_getReserves', function () {
  it('should return current state in the pools - extract ETH flow where eth > TARGET_LIQUIDITY', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController, mcr } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const mcrValue = await mcr.getMCR();

    // Set eth to 5100 so its > 5000 TARGET_LIQUIDITY (i.e. extract ETH)
    const state = {
      ...INITIAL_RAMM_STATE,
      timestamp: updatedAt,
      eth: TARGET_LIQUIDITY.add(parseEther('100')),
    };
    // Advance next block timestamp by 32 hours to reach book value (i.e. no ratchet)
    const nextBlockTimestamp = state.timestamp + 32 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    const expectedEthToExtract = calculateEthToExtract(state, nextBlockTimestamp, fixture.constants);
    const expectedEth = state.eth.sub(expectedEthToExtract);
    const expectedNxmA = getExpectedNxmABookValue(expectedEth, capital, supply, fixture.constants);
    const expectedNxmB = getExpectedNxmBBookValue(expectedEth, capital, supply, fixture.constants);
    const expectedBudget = state.budget;

    expect(injected).to.be.equal(0);
    expect(extracted).to.be.equal(expectedEthToExtract);

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(expectedBudget);
  });

  it('should return current state in the pools - extract ETH flow where eth == TARGET_LIQUIDITY', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController, mcr } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const mcrValue = await mcr.getMCR();

    // Set eth == TARGET_LIQUIDITY (i.e. extract ETH)
    const state = {
      ...INITIAL_RAMM_STATE,
      timestamp: updatedAt,
      eth: TARGET_LIQUIDITY,
    };
    // Advance next block timestamp by 32 hours to reach book value (i.e. no ratchet)
    const nextBlockTimestamp = state.timestamp + 32 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    const expectedEthToExtract = calculateEthToExtract(state, nextBlockTimestamp, fixture.constants);
    const expectedEth = state.eth.sub(expectedEthToExtract);
    const expectedNxmA = getExpectedNxmABookValue(expectedEth, capital, supply, fixture.constants);
    const expectedNxmB = getExpectedNxmBBookValue(expectedEth, capital, supply, fixture.constants);
    const expectedBudget = state.budget;

    expect(injected).to.be.equal(0);
    expect(extracted).to.be.equal(expectedEthToExtract);

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(expectedBudget);
  });

  it('should return current state in the pools - inject ETH flow where elapsed <= timeLeftOnBudget', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController, mcr } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const mcrValue = await mcr.getMCR();

    // Set eth be less than TARGET_LIQUIDITY (i.e. inject ETH)
    const state = {
      ...INITIAL_RAMM_STATE,
      timestamp: updatedAt,
      eth: TARGET_LIQUIDITY.sub(parseEther('100')),
    };
    // Advance next block time stamp by > 27 hrs (no ratchet) but < 701 hrs (timeLeftOnBudget)
    const nextBlockTimestamp = state.timestamp + 28 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    const expectedInjected = calculateEthToInject(state, nextBlockTimestamp, fixture.constants);

    expect(injected).to.be.equal(expectedInjected);
    expect(extracted).to.be.equal(0);

    const expectedEth = state.eth.add(injected);
    const expectedNxmA = getExpectedNxmABookValue(expectedEth, capital, supply, fixture.constants);
    const expectedNxmB = getExpectedNxmBBookValue(expectedEth, capital, supply, fixture.constants);
    const expectedBudget = state.budget.gt(injected) ? state.budget.sub(injected) : 0;

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(expectedBudget);
  });

  it('should return current state - 0 inject ETH when mcrValue + TARGET_LIQUIDITY reaches capital', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    // Set MCR so that MRC + TARGET_LIQUIDITY reaches capital and forces 0 injection
    const mcrValue = capital.sub(TARGET_LIQUIDITY);

    // Set eth be less than TARGET_LIQUIDITY (i.e. inject ETH)
    const state = {
      ...INITIAL_RAMM_STATE,
      timestamp: updatedAt,
      eth: TARGET_LIQUIDITY.sub(parseEther('100')),
    };
    // Advance next block time stamp by > 27 hrs (no ratchet)
    const nextBlockTimestamp = state.timestamp + 28 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    // Zero injection
    const expectedInjected = 0;

    expect(injected).to.be.equal(expectedInjected);
    expect(extracted).to.be.equal(0);

    const expectedEth = state.eth.add(expectedInjected);
    const expectedNxmA = getExpectedNxmABookValue(expectedEth, capital, supply, fixture.constants);
    const expectedNxmB = getExpectedNxmBBookValue(expectedEth, capital, supply, fixture.constants);
    const expectedBudget = state.budget.gt(expectedInjected) ? state.budget.sub(expectedInjected) : 0;

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(expectedBudget);
  });

  it('should return current state - inject ETH elapsed > timeLeftOnBudget (non zero budget)', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController, mcr } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const mcrValue = await mcr.getMCR();

    // Set eth be less than TARGET_LIQUIDITY (i.e. inject ETH)
    const state = {
      ...INITIAL_RAMM_STATE,
      timestamp: updatedAt,
      eth: TARGET_LIQUIDITY.sub(parseEther('100')),
    };
    // Advance next block time stamp > 27 hrs (no ratchet) and > 701 hrs timeLeftOnBudget (elapsed > timeLeftOnBudget)
    const nextBlockTimestamp = state.timestamp + 702 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    const expectedInjected = calculateEthToInject(state, nextBlockTimestamp, fixture.constants);

    expect(injected).to.be.equal(expectedInjected);
    expect(extracted).to.be.equal(0);

    const expectedEth = state.eth.add(expectedInjected);
    const expectedNxmA = getExpectedNxmABookValue(expectedEth, capital, supply, fixture.constants);
    const expectedNxmB = getExpectedNxmBBookValue(expectedEth, capital, supply, fixture.constants);
    const expectedBudget = state.budget.gt(expectedInjected) ? state.budget.sub(expectedInjected) : 0;

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(expectedBudget);
  });

  it('should return current state - inject ETH elapsed > timeLeftOnBudget (zero budget)', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController, mcr } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const mcrValue = await mcr.getMCR();

    // Set eth be less than TARGET_LIQUIDITY (i.e. inject ETH) and budget to 0 (i.e. elapsed > timeLeftOnBudget)
    const state = {
      ...INITIAL_RAMM_STATE,
      budget: BigNumber.from('0'),
      timestamp: updatedAt,
      eth: TARGET_LIQUIDITY.sub(parseEther('100')),
    };
    // Advance next block time stamp by > 27 hrs (no ratchet)
    const nextBlockTimestamp = state.timestamp + 28 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    const expectedInjected = calculateEthToInject(state, nextBlockTimestamp, fixture.constants);

    expect(injected).to.be.equal(expectedInjected);
    expect(extracted).to.be.equal(0);

    const expectedEth = state.eth.add(expectedInjected);
    const expectedNxmA = getExpectedNxmABookValue(expectedEth, capital, supply, fixture.constants);
    const expectedNxmB = getExpectedNxmBBookValue(expectedEth, capital, supply, fixture.constants);

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(0);
  });

  it('should return current state in the pools - ratchet value', async function () {
    const fixture = await loadFixture(setup);
    const { ramm, pool, tokenController, mcr } = fixture.contracts;
    const { TARGET_LIQUIDITY } = fixture.constants;

    const { updatedAt } = await ramm.slot1();
    const capital = await pool.getPoolValueInEth();
    const supply = await tokenController.totalSupply();
    const mcrValue = await mcr.getMCR();

    // Set budget to 0 and eth == TARGET_LIQUIDITY (i.e. extract ETH)
    const state = {
      ...INITIAL_RAMM_STATE,
      timestamp: updatedAt,
      budget: 0,
      eth: TARGET_LIQUIDITY,
    };
    // Advance next block timestamp < 31 hours to NOT reach book value (i.e. use ratchet)
    const nextBlockTimestamp = state.timestamp + 1 * 60 * 60;

    const [{ eth, nxmA, nxmB, budget }, injected, extracted] = await ramm._getReserves(
      state,
      capital,
      supply,
      mcrValue,
      nextBlockTimestamp,
    );

    const expectedEthToExtract = calculateEthToExtract(state, nextBlockTimestamp, fixture.constants);

    expect(injected).to.be.equal(0);
    expect(extracted).to.be.equal(expectedEthToExtract);

    const expectedEth = state.eth.sub(expectedEthToExtract);
    const expectedNxmA = getExpectedNxmARatchet(state, eth, capital, supply, nextBlockTimestamp, fixture.constants);
    const expectedNxmB = getExpectedNxmBRatchet(state, eth, capital, supply, nextBlockTimestamp, fixture.constants);
    const expectedBudget = state.budget;

    expect(eth).to.be.equal(expectedEth);
    expect(nxmA).to.be.equal(expectedNxmA);
    expect(nxmB).to.be.equal(expectedNxmB);
    expect(budget).to.be.equal(expectedBudget);
  });
});

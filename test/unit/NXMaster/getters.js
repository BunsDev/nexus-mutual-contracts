const { assert } = require('chai');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const setup = require('./setup');
const { hex } = require('../utils').helpers;

describe('getters', function () {
  let fixture;
  beforeEach(async function () {
    fixture = await loadFixture(setup);
  });

  it('retrieves existing contracts using getInternalContracts', async function () {
    const { master, governance } = fixture;

    const { _contractCodes, _contractAddresses } = await master.getInternalContracts();

    assert.equal(_contractCodes.length, 1);
    assert.equal(_contractAddresses.length, 1);
    assert.equal(_contractCodes[0], hex('GV'));
    assert.equal(_contractAddresses[0], governance.address);
  });

  it('retrieves existing contracts using getLatestAddress', async function () {
    const { master, governance } = fixture;

    const address = await master.getLatestAddress(hex('GV'));

    assert.equal(address, governance.address);
  });
});

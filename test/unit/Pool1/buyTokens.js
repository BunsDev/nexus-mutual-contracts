const { ether, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-environment');
const { assert } = require('chai');
const { hex } = require('../utils').helpers;
const { calculatePurchasedTokensWithFullIntegral, calculatePurchasedTokens } = require('../utils').tokenPrice;
const { BN } = web3.utils;
const { accounts, constants } = require('../utils');

const {
  nonMembers: [fundSource],
  members: [memberOne],
} = accounts;

describe('buyTokens', function () {

  const daiRate = new BN('39459');
  const ethRate = new BN('100');

  it('successfully buys tokens', async function () {
    const { pool1, poolData, token, tokenData } = this;

    const { _a: a, _c: c } = await poolData.getTokenPriceDetails(hex('ETH'));
    const tokenExponent = await tokenData.tokenExponent();

    const mcrEth = new BN('162424730681679380000000');
    const initialAssetValue = new BN('210959924071154460525457');
    const mcrPercentagex100 = initialAssetValue.mul(new BN(10000)).div(mcrEth);

    await pool1.sendTransaction({
      from: fundSource,
      value: initialAssetValue
    });

    await poolData.setAverageRate(hex('ETH'), ethRate);
    await poolData.setAverageRate(hex('DAI'), daiRate);

    const date = new Date().getTime();
    await poolData.setLastMCR(mcrPercentagex100, mcrEth, initialAssetValue, date);

    const buyValue = ether('1000');
    const preBuyBalance = await token.balanceOf(memberOne);

    await pool1.buyTokens( '1', {
      from: memberOne,
      value: buyValue
    });
    const postBuyBalance = await token.balanceOf(memberOne);
    const tokensReceived = postBuyBalance.sub(preBuyBalance);

    const { tokens: expectedtokenValue }  = calculatePurchasedTokens(
      initialAssetValue, buyValue, mcrEth, c, a.mul(new BN(1e13.toString())), tokenExponent
    );
    assert.equal(tokensReceived.toString(), expectedtokenValue.toString());
  });
});


const { accounts, web3,
  ethers
} = require('hardhat');
const { parseEther } = ethers.utils;
const { BigNumber } = ethers;
const { ether, expectRevert, time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');
const Decimal = require('decimal.js');

const toBN = BigNumber.from

const { calculateEthForNXMRelativeError, calculateNXMForEthRelativeError, getTokenSpotPrice } =
  require('../utils').tokenPrice;

const { enrollMember, enrollClaimAssessor } = require('../utils/enroll');
const { buyCover } = require('../utils').buyCover;
const { hex } = require('../utils').helpers;
const { PoolAsset } = require('../utils').constants;

const [, member1, member2, member3, member4, member5, coverHolder, nonMember1] = accounts;

const coverTemplate = {
  amount: 1, // 1 eth
  price: '3000000000000000', // 0.003 eth
  priceNXM: '1000000000000000000', // 1 nxm
  expireTime: '8000000000',
  generationTime: '1600000000000',
  currency: hex('ETH'),
  period: 60,
  contractAddress: '0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffee0000',
};

const ratioScale = toBN(10000);

describe('Token price functions', function () {
  beforeEach(async function () {

    const { tc, tk } = this.contracts;
    const [, , , , member4, member5] = this.accounts.members;


    await tk.connect(member4).approve(tc.address, ethers.constants.MaxUint256);
    await tk.transfer(member4.address, parseEther('1000'));
  });

  it('getTokenPrice returns spot price for all assets', async function () {
    const { p1: pool, mcr } = this.contracts;
    const { ethToDaiRate } = this.rates;

    const ethTokenPrice = await pool.getTokenPrice(0);
    const daiTokenPrice = await pool.getTokenPrice(1);

    const totalAssetValue = await pool.getPoolValueInEth();
    const mcrEth = await mcr.getMCR();
    const expectedEthTokenPrice = toBN(getTokenSpotPrice(totalAssetValue, mcrEth).toString());

    const ethPriceDiff = ethTokenPrice.sub(expectedEthTokenPrice).abs();
    assert(
      ethPriceDiff.lte(toBN(1)),
      `token price ${ethTokenPrice.toString()} not close enough to ${expectedEthTokenPrice.toString()}`,
    );

    const expectedDaiPrice = toBN(ethToDaiRate / 100).mul(expectedEthTokenPrice);
    const daiPriceDiff = daiTokenPrice.sub(expectedDaiPrice);
    assert(
      daiPriceDiff.lte(toBN(10000)), // negligible amount of wei
      `DAI token price ${daiTokenPrice.toString()} not close enough to ${expectedDaiPrice.toString()}`,
    );
  });

  it('buyNXM reverts for non-member', async function () {
    const { p1: pool } = this.contracts;
    const [nonMember1] = this.accounts.nonMembers;

    const buyValue = parseEther('10');
    await expect(
      pool.connect(nonMember1).buyNXM('0', { value: buyValue })
    ).to.be.revertedWith( 'Caller is not a member');
  });

  it('sellNXM reverts for non-member', async function () {
    const { p1: pool } = this.contracts;
    const [nonMember1] = this.accounts.nonMembers;

    await expect(pool.connect(nonMember1).sellNXM('1', '0')).to.be.revertedWith( 'Caller is not a member');
  });

  it('sellNXM reverts if member does not have enough NXM balance', async function () {
    const { p1: pool, tk: token } = this.contracts;

    const [member1] = this.accounts.members;
    const memberBalance = await token.balanceOf(member1.address);

    await expect(
      pool.connect(member1).sellNXM(memberBalance.add(1), '0')
    ).to.be.revertedWith( 'Pool: Not enough balance');
  });

  it('buyNXM mints tokens for member in exchange of ETH', async function () {
    const { tk: token, p1: pool, mcr } = this.contracts;

    const [member] = this.accounts.members;
    const buyValue = parseEther('1000');
    const expectedTokensReceived = await pool.getNXMForEth(buyValue);
    const totalAssetValue = await pool.getPoolValueInEth();
    const mcrEth = await mcr.getMCR();

    const preBuyBalance = await token.balanceOf(member.address);
    await pool.connect(member).buyNXM(expectedTokensReceived, { value: buyValue });

    const postBuyBalance = await token.balanceOf(member.address);
    const tokensReceived = postBuyBalance.sub(preBuyBalance);

    expect(tokensReceived).to.be.equal(expectedTokensReceived);

    const maxRelativeError = new Decimal(0.0006);
    const { relativeError } = calculateNXMForEthRelativeError(totalAssetValue, buyValue, mcrEth, tokensReceived);
    assert(
      relativeError.lt(maxRelativeError),
      `Relative error too high ${relativeError.toString()} > ${maxRelativeError.toFixed()}`,
    );
  });

  it.skip('sellNXM burns tokens for member and returns ETH', async function () {
    const { tk: token, p1: pool } = this.contracts;

    const [member1] = this.accounts.members;
    const ethIn = parseEther('500');
    const nxmAmount = await pool.getNXMForEth(ethIn);

    // buy tokens first
    await pool.buyNXM(nxmAmount, { from: member1, value: ethIn });

    // sell them back
    const preNXMSellBalance = await token.balanceOf(member1.address);
    const preSellTokenSupply = await token.totalSupply();
    const preSellEthBalance = await web3.eth.getBalance(member1.address);

    await pool.sellNXM(nxmAmount, '0', { from: member1, gasPrice: 0 });

    const postSellEthBalance = await web3.eth.getBalance(member1.address);
    const postSellNXMBalance = await token.balanceOf(member1.address);
    const postSellTokenSupply = await token.totalSupply();

    const tokensTakenAway = preNXMSellBalance.sub(postSellNXMBalance);
    const tokensBurned = preSellTokenSupply.sub(postSellTokenSupply);

    assert(tokensTakenAway.toString(), nxmAmount.toString());
    assert(tokensBurned.toString(), nxmAmount.toString());

    const ethOut = toBN(postSellEthBalance).sub(toBN(preSellEthBalance));

    const maxRelativeError = new Decimal(0.0002);
    const { relativeError } = calculateEthForNXMRelativeError(ethIn, ethOut);

    assert(
      relativeError.lt(maxRelativeError),
      `Relative error too high ${relativeError.toString()} > ${maxRelativeError.toFixed()}`,
    );
  });

  it('buyNXM token price reflects the latest lower MCR value (lower MCReth -> higher price)', async function () {
    const { p1: pool, mcr } = this.contracts;

    const [member1] = this.accounts.members;

    const buyValue = parseEther('1000');
    const expectedNXMOutPreMCRPosting = await pool.getNXMForEth(buyValue);
    const spotTokenPricePreMCRPosting = await pool.getTokenPrice(PoolAsset.ETH);
    await pool.getPoolValueInEth();

    // trigger an MCR update and post a lower MCR since lowering the price (higher MCR percentage)
    const minUpdateTime = await mcr.minUpdateTime();

    await time.increase(minUpdateTime + 1);

    // perform a buy with a negligible amount of ETH
    await pool.connect(member1).buyNXM('0', { value: '1' });
    // let time pass so that mcr decreases towards desired MCR
    await time.increase(time.duration.hours(6));

    const spotTokenPricePostMCRPosting = await pool.getTokenPrice(PoolAsset.ETH);
    const expectedNXMOutPostMCRPosting = await pool.getNXMForEth(buyValue);

    assert(
      spotTokenPricePostMCRPosting.gt(spotTokenPricePreMCRPosting),
      `Expected token price to be higher than ${spotTokenPricePreMCRPosting.toString()} at a lower mcrEth.
       Price: ${spotTokenPricePostMCRPosting.toString()}`,
    );
    assert(
      expectedNXMOutPostMCRPosting.lt(expectedNXMOutPreMCRPosting),
      `Expected to receive less tokens than ${expectedNXMOutPreMCRPosting.toString()} at a lower mcrEth.
       Receiving: ${expectedNXMOutPostMCRPosting.toString()}`,
    );
  });

  it.skip('buyNXM token price reflects the latest higher MCR value (higher MCReth -> lower price)', async function () {
    const { p1: pool, mcr } = this.contracts;

    const ETH = await pool.ETH();
    const buyValue = parseEther('1000');
    const expectedNXMOutPreMCRPosting = await pool.getNXMForEth(buyValue);
    const spotTokenPricePreMCRPosting = await pool.getTokenPrice(PoolAsset.ETH);
    await pool.getPoolValueInEth();

    const gearingFactor = await mcr.gearingFactor();
    const currentMCR = await mcr.getMCR();
    const coverAmount = toBN(gearingFactor)
      .mul(currentMCR.add(parseEther('300')))
      .div(parseEther('1'))
      .div(ratioScale);
    const cover = { ...coverTemplate, amount: coverAmount };

    // increase totalSumAssured to trigger MCR increase
    await buyCover({ ...this.contracts, cover, coverHolder });

    // trigger an MCR update and post a lower MCR since lowering the price (higher MCR percentage)
    const minUpdateTime = await mcr.minUpdateTime();
    await time.increase(minUpdateTime + 1);

    // perform a buy with a negligible amount of ETH
    await pool.connect(member1).buyNXM('0', { value: '1' });
    // let time pass so that mcr increases towards desired MCR
    await time.increase(time.duration.hours(6));

    const spotTokenPricePostMCRPosting = await pool.getTokenPrice(ETH);
    const expectedNXMOutPostMCRPosting = await pool.getNXMForEth(buyValue);

    assert(
      spotTokenPricePostMCRPosting.lt(spotTokenPricePreMCRPosting),
      `Expected token price to be lower than ${spotTokenPricePreMCRPosting.toString()} at a higher mcrEth.
       Price: ${spotTokenPricePostMCRPosting.toString()}`,
    );
    assert(
      expectedNXMOutPostMCRPosting.gt(expectedNXMOutPreMCRPosting),
      `Expected to receive more tokens than ${expectedNXMOutPreMCRPosting.toString()} at a higher mcrEth.
       Receiving: ${expectedNXMOutPostMCRPosting.toString()}`,
    );
  });

  it('getPoolValueInEth calculates pool value correctly', async function () {
    const { p1: pool, dai } = this.contracts;
    const { daiToEthRate } = this.rates;

    const poolBalance = toBN(await web3.eth.getBalance(pool.address));
    const daiBalance = await dai.balanceOf(pool.address);
    const expectedDAiValueInEth = daiToEthRate.mul(daiBalance).div(parseEther('1'));
    const expectedTotalAssetValue = poolBalance.add(expectedDAiValueInEth);
    const totalAssetValue = await pool.getPoolValueInEth();
    assert(totalAssetValue.toString(), expectedTotalAssetValue.toString());
  });

  it('getMCRRatio calculates MCR ratio correctly', async function () {
    const { p1: pool } = this.contracts;
    const mcrRatio = await pool.getMCRRatio();
    assert.equal(mcrRatio.toString(), '20000');
  });

  it.skip('sellNXM reverts for member if tokens are locked for member vote', async function () {
    // [todo] Use new contracts
    const { cd: claimsData, cl: claims, qd: quotationData, p1: pool, tk: token, cr } = this.contracts;
    const cover = { ...coverTemplate };
    await enrollClaimAssessor(this.contracts, [member1, member2, member3]);

    const buyValue = ether('1000');
    await pool.buyNXM('0', { from: member1, value: buyValue });
    const boughtTokenAmount = await token.balanceOf(member1);

    await buyCover({ ...this.contracts, cover, coverHolder });
    const [coverId] = await quotationData.getAllCoversOfUser(coverHolder);
    await claims.submitClaim(coverId, { from: coverHolder });
    const claimId = (await claimsData.actualClaimLength()).subn(1);

    // create a consensus not reached situation, 66% accept vs 33% deny
    await claims.submitCAVote(claimId, '1', { from: member1 });
    await claims.submitCAVote(claimId, toBN('-1'), { from: member2 });
    await claims.submitCAVote(claimId, '1', { from: member3 });

    const maxVotingTime = await claimsData.maxVotingTime();
    await time.increase(maxVotingTime.addn(1));

    await cr.closeClaim(claimId); // trigger changeClaimStatus
    const voteStatusAfter = await claims.checkVoteClosing(claimId);
    assert(voteStatusAfter.eqn(0), 'voting should not be closed');

    const { statno: claimStatusCA } = await claimsData.getClaimStatusNumber(claimId);
    assert.strictEqual(claimStatusCA.toNumber(), 4, 'claim status should be 4 (ca consensus not reached, pending mv)');

    await claims.submitMemberVote(claimId, '1', { from: member1 });
    await expectRevert(
      pool.sellNXM(boughtTokenAmount, '0', { from: member1 }),
      'Pool: NXM tokens are locked for voting',
    );
    await time.increase(maxVotingTime.addn(1));
    await cr.closeClaim(claimId);
  });
});

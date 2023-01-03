const { BigNumber } = require('ethers');
const { parseEther } = require('ethers/lib/utils');
const { ethers, expect } = require('hardhat');
const { increaseTime, mineNextBlock } = require('../../utils/evm');
const {
  getTranches,
  TRANCHE_DURATION,
  getNewRewardShares,
  calculateStakeAndRewardsWithdrawAmounts,
  setTime,
  generateRewards,
} = require('./helpers');

describe('withdraw', function () {
  const product0 = {
    productId: 0,
    weight: 100,
    initialPrice: '500',
    targetPrice: '500',
  };

  const initializeParams = {
    poolId: 0,
    isPrivatePool: false,
    initialPoolFee: 5, // 5%
    maxPoolFee: 5, // 5%
    productInitializationParams: [product0],
    ipfsDescriptionHash: 'Description Hash',
  };

  const withdrawFixture = {
    ...initializeParams,
    amount: parseEther('100'),
    trancheId: 0,
    tokenId: 1,
    destination: ethers.constants.AddressZero,
  };

  beforeEach(async function () {
    const {
      stakingPool,
      coverSigner,
      accounts: { defaultSender: manager },
    } = this;

    const { poolId, initialPoolFee, maxPoolFee, productInitializationParams, isPrivatePool, ipfsDescriptionHash } =
      initializeParams;

    await stakingPool
      .connect(coverSigner)
      .initialize(
        manager.address,
        isPrivatePool,
        initialPoolFee,
        maxPoolFee,
        productInitializationParams,
        poolId,
        ipfsDescriptionHash,
      );

    // Move to the beginning of the next tranche
    const { firstActiveTrancheId: trancheId } = await getTranches();
    await setTime((trancheId + 1) * TRANCHE_DURATION);
  });

  it('reverts if trying to withdraw stake locked in governance', async function () {
    const { nxm, stakingPool } = this;
    const manager = this.accounts.defaultSender;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position,
      destination,
    );

    await increaseTime(TRANCHE_DURATION);

    // Simulate manager lock in governance
    await nxm.setLock(manager.address, 1e6);

    const withdrawStake = true;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    await expect(
      stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds),
    ).to.be.revertedWith(
      'StakingPool: While the pool manager is locked for governance voting only rewards can be withdrawn',
    );
  });

  it('allows to withdraw only stake', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;

    const { amount: depositAmount, tokenId, destination } = withdrawFixture;
    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      depositAmount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    await generateRewards(stakingPool, coverSigner);
    await increaseTime(TRANCHE_DURATION);

    const withdrawStake = true;
    const withdrawRewards = false;
    const trancheIds = [firstActiveTrancheId];

    const depositBefore = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const depositAfter = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    const expectedShares = Math.sqrt(depositAmount);
    expect(depositBefore.stakeShares).to.be.eq(expectedShares);
    expect(depositAfter.stakeShares).to.be.eq(0);

    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(depositAmount));
    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(depositAmount));
  });

  it('transfers nxm stake and rewards from token controller to nft owner', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position,
      destination,
    );

    await generateRewards(stakingPool, coverSigner);

    await increaseTime(TRANCHE_DURATION);
    await mineNextBlock();

    const withdrawStake = true;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const deposit = await stakingPool.deposits(tokenId, firstActiveTrancheId);

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);
    const userBalanceAfter = await nxm.balanceOf(user.address);

    const { accNxmPerRewardShareAtExpiry } = await stakingPool.expiredTranches(firstActiveTrancheId);
    const rewardsWithdrawn = deposit.rewardsShares
      .mul(accNxmPerRewardShareAtExpiry.sub(deposit.lastAccNxmPerRewardShare))
      .div(parseEther('1'))
      .add(deposit.pendingRewards);

    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(amount));
    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(rewardsWithdrawn).add(amount));
  });

  it('allows to withdraw only rewards', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;
    const { defaultSender: manager } = this.accounts;

    const { amount, tokenId, destination } = withdrawFixture;
    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    const expectedStakeShares = Math.sqrt(amount);
    const expectedRewardShares = await getNewRewardShares({
      stakingPool,
      initialStakeShares: 0,
      stakeSharesIncrease: expectedStakeShares,
      initialTrancheId: firstActiveTrancheId,
      newTrancheId: firstActiveTrancheId,
    });

    const tcBalanceInitial = await nxm.balanceOf(tokenController.address);
    await generateRewards(stakingPool, coverSigner);

    const depositBefore = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const managerBalanceBefore = await nxm.balanceOf(manager.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    const managerTokenId = 0;
    const managerDepositBefore = await stakingPool.deposits(managerTokenId, firstActiveTrancheId);

    await increaseTime(TRANCHE_DURATION);

    const withdrawStake = false;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    // User withdraw
    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    // Manager withdraw
    await stakingPool.connect(manager).withdraw(managerTokenId, withdrawStake, withdrawRewards, trancheIds);

    const rewardPerSecondAfter = await stakingPool.rewardPerSecond();
    expect(rewardPerSecondAfter).to.equal(0);

    const depositAfter = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const managerBalanceAfter = await nxm.balanceOf(manager.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    expect(depositBefore.stakeShares).to.be.eq(expectedStakeShares);
    expect(depositAfter.stakeShares).to.be.eq(expectedStakeShares);

    expect(depositBefore.rewardsShares).to.be.eq(expectedRewardShares);
    expect(depositAfter.rewardsShares).to.be.eq(0);

    const { accNxmPerRewardShareAtExpiry } = await stakingPool.expiredTranches(firstActiveTrancheId);

    const expectedUserRewardsWithdrawn = depositBefore.rewardsShares
      .mul(accNxmPerRewardShareAtExpiry.sub(depositBefore.lastAccNxmPerRewardShare))
      .div(parseEther('1'))
      .add(depositBefore.pendingRewards);

    const expectedManagerRewardsWithdrawn = managerDepositBefore.rewardsShares
      .mul(accNxmPerRewardShareAtExpiry.sub(depositBefore.lastAccNxmPerRewardShare))
      .div(parseEther('1'))
      .add(managerDepositBefore.pendingRewards);

    const expectedRewardsWithdrawn = expectedUserRewardsWithdrawn.add(expectedManagerRewardsWithdrawn);
    const rewardsMinted = tcBalanceBefore.sub(tcBalanceInitial);

    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(expectedUserRewardsWithdrawn));
    expect(managerBalanceAfter).to.be.eq(managerBalanceBefore.add(expectedManagerRewardsWithdrawn));
    expect(tcBalanceAfter).to.be.eq(tcBalanceInitial.add(1)); // add 1 because of round error
    expect(expectedRewardsWithdrawn).to.be.eq(rewardsMinted.sub(1)); // sub 1 because of round error
  });

  it('allows to withdraw stake only if tranche is expired', async function () {
    const { tokenController, nxm, stakingPool } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    const withdrawStake = true;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    const depositBefore = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceBefore = await nxm.balanceOf(user.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await expect(stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds)).to.not.be
      .reverted;

    const depositAfter = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    // Nothing changes
    expect(depositBefore.stakeShares).to.be.eq(depositAfter.stakeShares);
    expect(userBalanceBefore).to.be.eq(userBalanceAfter);
    expect(tcBalanceBefore).to.be.eq(tcBalanceAfter);
  });

  it('allows to withdraw stake and rewards from multiple tranches', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user] = this.accounts.members;
    const { amount, tokenId, destination } = withdrawFixture;

    const TRANCHES_NUMBER = 5;
    const trancheIds = [];

    const withdrawStake = true;
    const withdrawRewards = true;

    for (let i = 0; i < TRANCHES_NUMBER; i++) {
      const { firstActiveTrancheId: currentTranche } = await getTranches();

      await stakingPool.connect(user).depositTo(
        amount,
        currentTranche,
        i === 0 ? 0 : tokenId, // Only create new position for the first tranche
        destination,
      );

      trancheIds.push(currentTranche);
      await generateRewards(stakingPool, coverSigner);
      await increaseTime(TRANCHE_DURATION);
      await mineNextBlock();
    }

    const depositsBeforeWithdraw = {};
    for (const tranche of trancheIds) {
      depositsBeforeWithdraw[tranche] = await stakingPool.deposits(tokenId, tranche);
    }

    const userBalanceBefore = await nxm.balanceOf(user.address);
    const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const lastTranche = trancheIds[TRANCHES_NUMBER - 1];
    const depositAfter = await stakingPool.deposits(tokenId, lastTranche);
    const userBalanceAfter = await nxm.balanceOf(user.address);
    const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

    expect(depositAfter.rewardsShares).to.be.eq(0);

    let rewardsWithdrawn = BigNumber.from(0);
    let stakeWithdrawn = BigNumber.from(0);
    for (const tranche of trancheIds) {
      const { rewards, stake } = await calculateStakeAndRewardsWithdrawAmounts(
        stakingPool,
        depositsBeforeWithdraw[tranche],
        tranche,
      );

      rewardsWithdrawn = rewardsWithdrawn.add(rewards);
      stakeWithdrawn = stakeWithdrawn.add(stake);
    }

    expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(rewardsWithdrawn).add(stakeWithdrawn));
    expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(stakeWithdrawn));
  });

  it('update tranches', async function () {
    const { coverSigner, stakingPool } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position,
      destination,
    );

    const withdrawStake = false;
    const withdrawRewards = true;
    const trancheIds = [firstActiveTrancheId];

    const activeStakeBefore = await stakingPool.activeStake();
    const accNxmPerRewardsShareBefore = await stakingPool.accNxmPerRewardsShare();
    const lastAccNxmUpdateBefore = await stakingPool.lastAccNxmUpdate();
    const stakeSharesSupplyBefore = await stakingPool.stakeSharesSupply();
    const rewardsSharesSupplyBefore = await stakingPool.rewardsSharesSupply();

    await generateRewards(stakingPool, coverSigner);

    await increaseTime(TRANCHE_DURATION);
    await mineNextBlock();

    await stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds);

    const activeStakeAfter = await stakingPool.activeStake();
    const accNxmPerRewardsShareAfter = await stakingPool.accNxmPerRewardsShare();
    const lastAccNxmUpdateAfter = await stakingPool.lastAccNxmUpdate();
    const stakeSharesSupplyAfter = await stakingPool.stakeSharesSupply();
    const rewardsSharesSupplyAfter = await stakingPool.rewardsSharesSupply();

    expect(activeStakeAfter).to.not.eq(activeStakeBefore);
    expect(accNxmPerRewardsShareAfter).to.not.eq(accNxmPerRewardsShareBefore);
    expect(lastAccNxmUpdateAfter).to.not.eq(lastAccNxmUpdateBefore);
    expect(stakeSharesSupplyAfter).to.not.eq(stakeSharesSupplyBefore);
    expect(rewardsSharesSupplyAfter).to.not.eq(rewardsSharesSupplyBefore);
  });

  it('anyone can call to withdraw stake and rewards for a token id', async function () {
    const { coverSigner, stakingPool, nxm } = this;
    const [user] = this.accounts.members;
    const [randomUser] = this.accounts.nonMembers;

    const { amount, tokenId, destination } = withdrawFixture;

    const { firstActiveTrancheId } = await getTranches();

    await stakingPool.connect(user).depositTo(
      amount,
      firstActiveTrancheId,
      0, // new position
      destination,
    );

    const withdrawStake = true;
    const withdrawRewards = false;
    const trancheIds = [firstActiveTrancheId];

    await generateRewards(stakingPool, coverSigner);

    const deposit = await stakingPool.deposits(tokenId, firstActiveTrancheId);
    await increaseTime(TRANCHE_DURATION);

    const userBalanceBefore = await nxm.balanceOf(user.address);
    const randomUserBalanceBefore = await nxm.balanceOf(randomUser.address);

    await expect(stakingPool.connect(randomUser).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds)).to.not
      .be.reverted;

    const { stake } = await calculateStakeAndRewardsWithdrawAmounts(stakingPool, deposit, firstActiveTrancheId);

    const userBalanceAfter = await nxm.balanceOf(user.address);
    const randomUserBalanceAfter = await nxm.balanceOf(randomUser.address);

    expect(randomUserBalanceAfter).to.eq(randomUserBalanceBefore);
    expect(userBalanceAfter).to.eq(userBalanceBefore.add(stake));
  });

  it('should emit some event', async function () {
    const { coverSigner, stakingPool } = this;
    const [user] = this.accounts.members;

    const { amount, tokenId, destination } = withdrawFixture;

    const TRANCHES_NUMBER = 3;
    const trancheIds = [];

    const withdrawStake = true;
    const withdrawRewards = true;

    for (let i = 0; i < TRANCHES_NUMBER; i++) {
      const { firstActiveTrancheId: currentTranche } = await getTranches();

      await stakingPool.connect(user).depositTo(
        amount.mul(i * 5 + 1),
        currentTranche,
        i === 0 ? 0 : tokenId, // Only create new position for the first tranche
        destination,
      );

      trancheIds.push(currentTranche);
      await generateRewards(stakingPool, coverSigner);
      await increaseTime(TRANCHE_DURATION);
      await mineNextBlock();
    }

    const depositsBeforeWithdraw = {};
    for (const tranche of trancheIds) {
      depositsBeforeWithdraw[tranche] = await stakingPool.deposits(tokenId, tranche);
    }

    // Update expiredTranches
    await stakingPool.processExpirations(true);

    const stakes = [];
    const rewards = [];
    for (const tranche of trancheIds) {
      const { rewards: currentReward, stake } = await calculateStakeAndRewardsWithdrawAmounts(
        stakingPool,
        depositsBeforeWithdraw[tranche],
        tranche,
      );

      stakes.push(stake);
      rewards.push(currentReward);
    }

    await expect(stakingPool.connect(user).withdraw(tokenId, withdrawStake, withdrawRewards, trancheIds))
      .to.emit(stakingPool, 'Withdraw')
      .withArgs(user.address, tokenId, trancheIds[0], stakes[0], rewards[0])
      .to.emit(stakingPool, 'Withdraw')
      .withArgs(user.address, tokenId, trancheIds[1], stakes[1], rewards[1])
      .to.emit(stakingPool, 'Withdraw')
      .withArgs(user.address, tokenId, trancheIds[2], stakes[2], rewards[2]);
  });

  it('allow multiple users to withdraw stake and rewards from multiple tranches', async function () {
    const { nxm, coverSigner, stakingPool, tokenController } = this;
    const [user1, user2, user3] = this.accounts.members;
    const { amount, destination } = withdrawFixture;

    const users = [user1, user2, user3];
    const tokenIds = [1, 2, 3];
    const TRANCHES_NUMBER = 5;
    const trancheIds = [];

    const withdrawStake = true;
    const withdrawRewards = true;

    for (let i = 0; i < TRANCHES_NUMBER; i++) {
      const { firstActiveTrancheId: currentTranche } = await getTranches();

      for (let j = 0; j < users.length; j++) {
        const user = users[j];

        await stakingPool.connect(user).depositTo(
          amount,
          currentTranche,
          i === 0 ? 0 : tokenIds[j], // Only create new position for the first tranche
          destination,
        );
      }

      trancheIds.push(currentTranche);
      await generateRewards(stakingPool, coverSigner);
      await increaseTime(TRANCHE_DURATION);
      await mineNextBlock();
    }

    const depositsBeforeWithdraw = {};
    for (const tranche of trancheIds) {
      depositsBeforeWithdraw[tranche] = {};

      for (let i = 0; i < users.length; i++) {
        depositsBeforeWithdraw[tranche][i] = await stakingPool.deposits(tokenIds[i], tranche);
      }
    }

    for (let i = 0; i < users.length; i++) {
      const user = users[i];

      const userBalanceBefore = await nxm.balanceOf(user.address);
      const tcBalanceBefore = await nxm.balanceOf(tokenController.address);

      await stakingPool.connect(user).withdraw(tokenIds[i], withdrawStake, withdrawRewards, trancheIds);

      const userBalanceAfter = await nxm.balanceOf(user.address);
      const tcBalanceAfter = await nxm.balanceOf(tokenController.address);

      let rewardsWithdrawn = BigNumber.from(0);
      let stakeWithdrawn = BigNumber.from(0);
      for (const tranche of trancheIds) {
        const { rewards, stake } = await calculateStakeAndRewardsWithdrawAmounts(
          stakingPool,
          depositsBeforeWithdraw[tranche][i],
          tranche,
        );

        rewardsWithdrawn = rewardsWithdrawn.add(rewards);
        stakeWithdrawn = stakeWithdrawn.add(stake);
      }

      expect(userBalanceAfter).to.be.eq(userBalanceBefore.add(rewardsWithdrawn).add(stakeWithdrawn));
      expect(tcBalanceAfter).to.be.eq(tcBalanceBefore.sub(rewardsWithdrawn).sub(stakeWithdrawn));
    }
  });
});

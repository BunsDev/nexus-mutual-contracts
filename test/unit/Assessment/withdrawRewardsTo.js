const { ethers } = require('hardhat');
const { expect } = require('chai');
const { setTime, daysToSeconds } = require('./helpers');

const { parseEther } = ethers.utils;

describe('withdrawRewardsTo', function () {
  it('reverts if there are no withdrawable rewards', async function () {
    const { assessment } = this.contracts;
    const [user] = this.accounts.members;
    await assessment.connect(user).stake(parseEther('10'));
    expect(assessment.connect(user).withdrawRewardsTo(user.address, 0)).to.be.revertedWith('No withdrawable rewards');
  });

  it('reverts when not called by the owner of the rewards ', async function () {
    const { nxm, assessment, individualClaims } = this.contracts;
    const [staker] = this.accounts.members;
    const { minVotingPeriodInDays, payoutCooldownInDays } = await assessment.config();
    await assessment.connect(staker).stake(parseEther('10'));

    await individualClaims.connect(staker).submitClaim(0, 0, parseEther('100'), '');
    await assessment.connect(staker).castVote(0, true);
    const { timestamp } = await ethers.provider.getBlock('latest');
    await setTime(timestamp + daysToSeconds(minVotingPeriodInDays + payoutCooldownInDays));

    const [nonMember] = this.accounts.nonMembers;
    const { totalReward } = await assessment.assessments(0);
    const nonMemberBalanceBefore = await nxm.balanceOf(nonMember.address);
    const stakerBalanceBefore = await nxm.balanceOf(staker.address);
    await expect(
      assessment.connect(nonMember).withdrawRewardsTo(staker.address, 0, { gasPrice: 0 }),
    ).to.be.revertedWith('No withdrawable rewards');
    await expect(assessment.connect(staker).withdrawRewardsTo(staker.address, 0, { gasPrice: 0 })).not.to.be.reverted;
    const nonMemberBalanceAfter = await nxm.balanceOf(nonMember.address);
    const stakerBalanceAfter = await nxm.balanceOf(staker.address);
    expect(nonMemberBalanceAfter).to.be.equal(nonMemberBalanceBefore);
    expect(stakerBalanceAfter).to.be.equal(stakerBalanceBefore.add(totalReward));
  });

  it('sends the rewards to any given destination address', async function () {
    const { nxm, assessment, individualClaims } = this.contracts;
    const [staker, otherMember] = this.accounts.members;
    const { minVotingPeriodInDays, payoutCooldownInDays } = await assessment.config();
    await assessment.connect(staker).stake(parseEther('10'));

    await individualClaims.connect(staker).submitClaim(0, 0, parseEther('100'), '');
    await assessment.connect(staker).castVote(0, true);
    const { timestamp } = await ethers.provider.getBlock('latest');
    await setTime(timestamp + daysToSeconds(minVotingPeriodInDays + payoutCooldownInDays));

    const { totalReward } = await assessment.assessments(0);
    const nonMemberBalanceBefore = await nxm.balanceOf(staker.address);
    const stakerBalanceBefore = await nxm.balanceOf(otherMember.address);
    await expect(assessment.connect(staker).withdrawRewardsTo(otherMember.address, 0, { gasPrice: 0 })).not.to.be
      .reverted;
    const nonMemberBalanceAfter = await nxm.balanceOf(staker.address);
    const stakerBalanceAfter = await nxm.balanceOf(otherMember.address);
    expect(nonMemberBalanceAfter).to.be.equal(nonMemberBalanceBefore);
    expect(stakerBalanceAfter).to.be.equal(stakerBalanceBefore.add(totalReward));
  });

  it('withdraws rewards only until the last finalized assessment when an unfinalized assessment follows', async function () {
    const { nxm, assessment, individualClaims } = this.contracts;
    const [user] = this.accounts.members;
    const { minVotingPeriodInDays, payoutCooldownInDays } = await assessment.config();
    await assessment.connect(user).stake(parseEther('10'));

    await individualClaims.connect(user).submitClaim(0, 0, parseEther('100'), '');
    await assessment.connect(user).castVote(0, true);
    const { timestamp } = await ethers.provider.getBlock('latest');
    await setTime(timestamp + daysToSeconds(minVotingPeriodInDays + payoutCooldownInDays));

    await individualClaims.connect(user).submitClaim(1, 0, parseEther('100'), '');
    await assessment.connect(user).castVote(1, true);

    await individualClaims.connect(user).submitClaim(2, 0, parseEther('100'), '');
    await assessment.connect(user).castVote(2, true);

    const balanceBefore = await nxm.balanceOf(user.address);

    await assessment.connect(user).withdrawRewardsTo(user.address, 0);
    const { rewardsWithdrawableFromIndex } = await assessment.stakeOf(user.address);
    expect(rewardsWithdrawableFromIndex).to.be.equal(1);

    const { totalReward } = await assessment.assessments(0);
    const balanceAfter = await nxm.balanceOf(user.address);
    expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward));
  });

  it("mints rewards pro-rated by the user's stake at vote time, to the total amount staked on that assessment", async function () {
    const { nxm, assessment, individualClaims } = this.contracts;
    const [user1, user2, user3] = this.accounts.members;
    const { minVotingPeriodInDays, payoutCooldownInDays } = await assessment.config();

    {
      await individualClaims.connect(user1).submitClaim(0, 0, parseEther('100'), '');
      await assessment.connect(user1).stake(parseEther('10'));
      await assessment.connect(user2).stake(parseEther('10'));
      await assessment.connect(user3).stake(parseEther('10'));

      await assessment.connect(user1).castVote(0, true);
      await assessment.connect(user2).castVote(0, true);
      await assessment.connect(user3).castVote(0, true);
      const { totalReward } = await assessment.assessments(0);

      const { timestamp } = await ethers.provider.getBlock('latest');
      await setTime(timestamp + daysToSeconds(minVotingPeriodInDays + payoutCooldownInDays));

      {
        const balanceBefore = await nxm.balanceOf(user1.address);
        await assessment.connect(user1).withdrawRewardsTo(user1.address, 0);
        const balanceAfter = await nxm.balanceOf(user1.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.div(3)));
      }

      {
        const balanceBefore = await nxm.balanceOf(user2.address);
        await assessment.connect(user2).withdrawRewardsTo(user2.address, 0);
        const balanceAfter = await nxm.balanceOf(user2.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.div(3)));
      }

      {
        const balanceBefore = await nxm.balanceOf(user3.address);
        await assessment.connect(user3).withdrawRewardsTo(user3.address, 0);
        const balanceAfter = await nxm.balanceOf(user3.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.div(3)));
      }
    }

    {
      await individualClaims.connect(user1).submitClaim(1, 0, parseEther('100'), '');

      await assessment.connect(user1).castVote(1, true);
      await assessment.connect(user2).castVote(1, true);
      const { totalReward } = await assessment.assessments(1);

      const { timestamp } = await ethers.provider.getBlock('latest');
      await setTime(timestamp + daysToSeconds(minVotingPeriodInDays + payoutCooldownInDays));

      {
        const balanceBefore = await nxm.balanceOf(user1.address);
        await assessment.connect(user1).withdrawRewardsTo(user1.address, 0);
        const balanceAfter = await nxm.balanceOf(user1.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.div(2)));
      }

      {
        const balanceBefore = await nxm.balanceOf(user2.address);
        await assessment.connect(user2).withdrawRewardsTo(user2.address, 0);
        const balanceAfter = await nxm.balanceOf(user2.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.div(2)));
      }
    }

    {
      await individualClaims.connect(user1).submitClaim(2, 0, parseEther('100'), '');
      await assessment.connect(user1).stake(parseEther('10'));
      await assessment.connect(user2).stake(parseEther('27'));
      await assessment.connect(user3).stake(parseEther('33'));

      await assessment.connect(user1).castVote(2, true);
      await assessment.connect(user2).castVote(2, true);
      await assessment.connect(user3).castVote(2, true);
      const { totalReward } = await assessment.assessments(2);

      const { timestamp } = await ethers.provider.getBlock('latest');
      await setTime(timestamp + daysToSeconds(minVotingPeriodInDays + payoutCooldownInDays));

      {
        const balanceBefore = await nxm.balanceOf(user1.address);
        await assessment.connect(user1).withdrawRewardsTo(user1.address, 0);
        const balanceAfter = await nxm.balanceOf(user1.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.mul(20).div(100)));
      }

      {
        const balanceBefore = await nxm.balanceOf(user2.address);
        await assessment.connect(user2).withdrawRewardsTo(user2.address, 0);
        const balanceAfter = await nxm.balanceOf(user2.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.mul(37).div(100)));
      }

      {
        const balanceBefore = await nxm.balanceOf(user3.address);
        await assessment.connect(user3).withdrawRewardsTo(user3.address, 0);
        const balanceAfter = await nxm.balanceOf(user3.address);
        expect(balanceAfter).to.be.equal(balanceBefore.add(totalReward.mul(43).div(100)));
      }
    }
  });
});

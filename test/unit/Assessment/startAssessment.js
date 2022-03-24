const { ethers } = require('hardhat');
const { expect } = require('chai');
const { daysToSeconds } = require('./helpers');

const { parseEther } = ethers.utils;
const { Zero } = ethers.constants;

describe('startAssessment', function () {
  it('returns the index of the newly created assessment', async function () {
    const { individualClaims, yieldTokenIncidents } = this.contracts;
    const [user] = this.accounts.members;
    const [AB] = this.accounts.advisoryBoardMembers;
    const { timestamp } = await ethers.provider.getBlock('latest');

    {
      await individualClaims.connect(user).submitClaim(0, 0, parseEther('100'), '');
      const { assessmentId } = await individualClaims.claims(0);
      expect(assessmentId).to.be.equal(0);
    }

    {
      await yieldTokenIncidents.connect(AB).submitIncident(0, parseEther('1'), timestamp, parseEther('1000'));
      const { assessmentId } = await yieldTokenIncidents.incidents(0);
      expect(assessmentId).to.be.equal(1);
    }

    {
      await individualClaims.connect(user).submitClaim(2, 0, parseEther('100'), '');
      const { assessmentId } = await individualClaims.claims(1);
      expect(assessmentId).to.be.equal(2);
    }

    {
      await individualClaims.connect(user).submitClaim(3, 0, parseEther('100'), '');
      const { assessmentId } = await individualClaims.claims(2);
      expect(assessmentId).to.be.equal(3);
    }

    {
      await yieldTokenIncidents.connect(AB).submitIncident(0, parseEther('1'), timestamp, parseEther('1000'));
      const { assessmentId } = await yieldTokenIncidents.incidents(1);
      expect(assessmentId).to.be.equal(4);
    }
  });

  it('stores assessmentDeposit and totalReward', async function () {
    const { individualClaims, yieldTokenIncidents, assessment } = this.contracts;
    const [user] = this.accounts.members;
    const [AB] = this.accounts.advisoryBoardMembers;
    const { timestamp } = await ethers.provider.getBlock('latest');

    {
      await individualClaims.connect(user).submitClaim(0, 0, parseEther('100'), '');
      const { assessmentDeposit, totalReward } = await assessment.assessments(0);
      const { rewardRatio } = await individualClaims.config();
      expect(assessmentDeposit).to.be.equal(0);
      expect(totalReward).to.be.equal(
        parseEther('100')
          .mul(rewardRatio)
          .div('10000'),
      );
    }

    {
      const activeCoverAmountInNXM = parseEther('1000');
      await yieldTokenIncidents.connect(AB).submitIncident(0, parseEther('1'), timestamp, activeCoverAmountInNXM);
      const { assessmentDeposit, totalReward } = await assessment.assessments(1);
      const { rewardRatio, expectedPayoutRatio } = await yieldTokenIncidents.config();

      // For now being AB only, it doesn't require a deposit to submit yieldTokenIncidents
      expect(assessmentDeposit).to.be.equal(Zero);
      expect(totalReward).to.be.equal(
        activeCoverAmountInNXM
          .mul(rewardRatio)
          .div(10000)
          .mul(expectedPayoutRatio)
          .div(10000),
      );
    }
  });

  it('stores assessmentDeposit and totalReward', async function () {
    const { individualClaims, yieldTokenIncidents, assessment } = this.contracts;
    const [user] = this.accounts.members;
    const [AB] = this.accounts.advisoryBoardMembers;
    const { timestamp } = await ethers.provider.getBlock('latest');

    {
      await individualClaims.connect(user).submitClaim(0, 0, parseEther('100'), '');
      const { assessmentDeposit, totalReward } = await assessment.assessments(0);
      const { rewardRatio } = await individualClaims.config();
      expect(assessmentDeposit).to.be.equal(0);
      expect(totalReward).to.be.equal(
        parseEther('100')
          .mul(rewardRatio)
          .div('10000'),
      );
    }

    {
      const activeCoverAmountInNXM = parseEther('1000');
      await yieldTokenIncidents.connect(AB).submitIncident(0, parseEther('1'), timestamp, activeCoverAmountInNXM);
      const { assessmentDeposit, totalReward } = await assessment.assessments(1);
      const { rewardRatio, expectedPayoutRatio } = await yieldTokenIncidents.config();
      expect(assessmentDeposit).to.be.equal(Zero); // For now AB doesn't require a deposit to submit yieldTokenIncidents
      expect(totalReward).to.be.equal(
        activeCoverAmountInNXM
          .mul(rewardRatio)
          .div(10000)
          .mul(expectedPayoutRatio)
          .div(10000),
      );
    }
  });

  it('stores a poll that starts at the block timestamp and ends after minVotingPeriodInDays', async function () {
    const { individualClaims, yieldTokenIncidents, assessment } = this.contracts;
    const [user] = this.accounts.members;
    const [AB] = this.accounts.advisoryBoardMembers;

    {
      await individualClaims.connect(user).submitClaim(0, 0, parseEther('100'), '');
      const { timestamp } = await ethers.provider.getBlock('latest');
      const { poll } = await assessment.assessments(0);
      const { minVotingPeriodInDays } = await assessment.config();
      expect(poll.start).to.be.equal(timestamp);
      expect(poll.end).to.be.equal(timestamp + daysToSeconds(minVotingPeriodInDays));
      expect(poll.accepted).to.be.equal(0);
      expect(poll.denied).to.be.equal(0);
    }

    {
      const { timestamp } = await ethers.provider.getBlock('latest');
      await yieldTokenIncidents.connect(AB).submitIncident(0, parseEther('1'), timestamp, Zero);
      const { poll } = await assessment.assessments(0);
      const { minVotingPeriodInDays } = await assessment.config();
      expect(poll.start).to.be.equal(timestamp);
      expect(poll.end).to.be.equal(timestamp + daysToSeconds(minVotingPeriodInDays));
      expect(poll.accepted).to.be.equal(0);
      expect(poll.denied).to.be.equal(0);
    }
  });
});

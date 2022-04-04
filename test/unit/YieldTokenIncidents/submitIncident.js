const { ethers } = require('hardhat');
const { expect } = require('chai');

const { parseEther } = ethers.utils;

describe('submitIncident', function () {
  it('reverts if the product uses a different redeem method', async function () {
    const { yieldTokenIncidents } = this.contracts;
    const [advisoryBoard] = this.accounts.advisoryBoardMembers;

    {
      const productId = 0;
      const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
      await expect(
        yieldTokenIncidents
          .connect(advisoryBoard)
          .submitIncident(productId, parseEther('1.1'), currentTime, parseEther('20000'), ''),
      ).to.be.revertedWith('Invalid redeem method');
    }

    {
      const productId = 1;
      const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
      await expect(
        yieldTokenIncidents
          .connect(advisoryBoard)
          .submitIncident(productId, parseEther('1.1'), currentTime, parseEther('20000'), ''),
      ).to.be.revertedWith('Invalid redeem method');
    }
  });

  it('calls startAssessment and stores the returned assessmentId in the incident', async function () {
    const { yieldTokenIncidents } = this.contracts;
    const [advisoryBoard] = this.accounts.advisoryBoardMembers;

    {
      const productId = 2;
      const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
      await yieldTokenIncidents
        .connect(advisoryBoard)
        .submitIncident(productId, parseEther('1.1'), currentTime, parseEther('20000'), '');
      const expectedAssessmentId = 0;
      const { assessmentId } = await yieldTokenIncidents.incidents(0);
      expect(assessmentId).to.be.equal(expectedAssessmentId);
    }

    {
      const productId = 2;
      const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
      await yieldTokenIncidents
        .connect(advisoryBoard)
        .submitIncident(productId, parseEther('1.1'), currentTime, parseEther('20000'), '');
      const expectedAssessmentId = 1;
      const { assessmentId } = await yieldTokenIncidents.incidents(1);
      expect(assessmentId).to.be.equal(expectedAssessmentId);
    }
  });

  it('pushes an incident with productId, date and priceBefore to incidents', async function () {
    const { yieldTokenIncidents } = this.contracts;
    const [advisoryBoard] = this.accounts.advisoryBoardMembers;

    const expectedProductId = 2;
    const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
    const expectedPriceBefore = parseEther('1.1');
    await yieldTokenIncidents
      .connect(advisoryBoard)
      .submitIncident(expectedProductId, expectedPriceBefore, currentTime, parseEther('20000'), '');
    const { productId, date, priceBefore } = await yieldTokenIncidents.incidents(0);
    expect(productId).to.be.equal(expectedProductId);
    expect(date).to.be.equal(currentTime);
    expect(priceBefore).to.be.equal(expectedPriceBefore);
  });

  it('calculates the total reward using the expected payout amount parameter provided', async function () {
    const { assessment, yieldTokenIncidents } = this.contracts;
    const [advisoryBoard] = this.accounts.advisoryBoardMembers;

    const productId = 2;
    const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
    const expectedPayoutAmount = parseEther('100');
    await yieldTokenIncidents
      .connect(advisoryBoard)
      .submitIncident(productId, parseEther('1.1'), currentTime, expectedPayoutAmount, '');
    const expectedTotalReward = expectedPayoutAmount.mul(this.config.rewardRatio).div(10000);
    const { totalReward } = await assessment.assessments(0);
    expect(totalReward).to.be.equal(expectedTotalReward);
  });

  it('calculates the totalReward capped at config.maxRewardInNXMWad', async function () {
    const { assessment, yieldTokenIncidents } = this.contracts;
    const [advisoryBoard] = this.accounts.advisoryBoardMembers;
    const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
    const productId = 2;

    await yieldTokenIncidents
      .connect(advisoryBoard)
      .submitIncident(productId, parseEther('1.1'), currentTime, parseEther('100000000'), '');
    const expectedTotalReward = parseEther(this.config.maxRewardInNXMWad.toString());

    const { totalReward } = await assessment.assessments(0);
    expect(totalReward).to.be.equal(expectedTotalReward);
  });

  it('emits MetadataSubmitted event with the provided ipfsMetadata when it is not empty string', async function () {
    const { yieldTokenIncidents } = this.contracts;
    const [advisoryBoard] = this.accounts.advisoryBoardMembers;
    const { timestamp: currentTime } = await ethers.provider.getBlock('latest');
    const productId = 2;

    await expect(
      yieldTokenIncidents
        .connect(advisoryBoard)
        .submitIncident(productId, parseEther('1.1'), currentTime, parseEther('10000'), 'ipfsMetadata1'),
    )
      .to.emit(yieldTokenIncidents, 'MetadataSubmitted')
      .withArgs(0, parseEther('10000'), 'ipfsMetadata1');

    await expect(
      yieldTokenIncidents
        .connect(advisoryBoard)
        .submitIncident(productId, parseEther('1.2'), currentTime, parseEther('20000'), 'ipfsMetadata2'),
    )
      .to.emit(yieldTokenIncidents, 'MetadataSubmitted')
      .withArgs(1, parseEther('20000'), 'ipfsMetadata2');
  });
});

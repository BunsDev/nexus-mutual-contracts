const { ethers } = require('hardhat');
const { parseEther } = ethers.utils;

const CLAIM_STATUS = {
  PENDING: 0,
  ACCEPTED: 1,
  DENIED: 2,
};

const PAYOUT_STATUS = {
  PENDING: 0,
  COMPLETE: 1,
  UNCLAIMED: 2,
  DENIED: 3,
};

const ASSET = {
  ETH: 0,
  DAI: 1,
};

const submitClaim =
  ({ accounts, contracts }) =>
  async ({
    coverId = 0,
    segmentId = 0,
    amount = parseEther('1'),
    coverPeriod = 0,
    coverAsset = 0,
    ipfsMetadata = '',
    sender,
    value,
  }) => {
    const [deposit] = await contracts.individualClaims.getAssessmentDepositAndReward(amount, coverPeriod, coverAsset);
    return await contracts.individualClaims
      .connect(sender || accounts[0])
      .submitClaim(coverId, segmentId, amount, ipfsMetadata, { value: value || deposit });
  };

const getConfigurationStruct = ({ rewardRatio, minAssessmentDepositRatio }) => [rewardRatio, minAssessmentDepositRatio];

const getPollStruct = ({ accepted, denied, start, end }) => [accepted, denied, start, end];

const getVoteStruct = ({ accepted, denied, start, end }) => [accepted, denied, start, end];

const getClaimDetailsStruct = ({
  amount,
  coverId,
  coverPeriod,
  coverAsset,
  nxmPriceSnapshot,
  minAssessmentDepositRatio,
  payoutRedeemed,
}) => [amount, coverId, coverPeriod, coverAsset, nxmPriceSnapshot, minAssessmentDepositRatio, payoutRedeemed];

const getIncidentDetailsStruct = ({
  productId,
  date,
  coverAsset,
  activeCoverAmount,
  expectedPayoutRatio,
  minAssessmentDepositRatio,
}) => [productId, date, coverAsset, activeCoverAmount, expectedPayoutRatio, minAssessmentDepositRatio];

const coverSegmentFixture = {
  amount: parseEther('100'),
  start: 0,
  period: 30 * 24 * 60 * 60,
  gracePeriodInDays: 7,
  priceRatio: 0,
  expired: false,
  globalRewardsRatio: 0,
};

const getCoverSegment = async () => {
  const { timestamp } = await ethers.provider.getBlock('latest');
  const cover = { ...coverSegmentFixture };
  cover.start = timestamp + 1;
  return cover;
};

module.exports = {
  ASSET,
  CLAIM_STATUS,
  PAYOUT_STATUS,
  submitClaim,
  getPollStruct,
  getConfigurationStruct,
  getClaimDetailsStruct,
  getIncidentDetailsStruct,
  getVoteStruct,
  getCoverSegment,
};

// SPDX-License-Identifier: GPL-3.0-only

pragma solidity >=0.5.0;

/* structs for io */

struct AllocationRequest {
  uint productId;
  uint coverId;
  uint allocationId;
  uint period;
  uint gracePeriod;
  bool useFixedPrice;
  uint previousStart;
  uint previousExpiration;
  uint previousRewardsRatio;
  uint globalCapacityRatio;
  uint capacityReductionRatio;
  uint rewardRatio;
  uint globalMinPrice;
}

struct StakedProductParam {
  uint productId;
  bool recalculateEffectiveWeight;
  bool setTargetWeight;
  uint8 targetWeight;
  bool setTargetPrice;
  uint96 targetPrice;
}

struct ProductInitializationParams {
  uint productId;
  uint8 weight;
  uint96 initialPrice;
  uint96 targetPrice;
}

interface IStakingPool {

  /* structs for storage */

  // stakers are grouped in tranches based on the timelock expiration
  // tranche index is calculated based on the expiration date
  // the initial proposal is to have 4 tranches per year (1 tranche per quarter)
  struct Tranche {
    uint128 stakeShares;
    uint128 rewardsShares;
  }

  struct ExpiredTranche {
    uint96 accNxmPerRewardShareAtExpiry;
    uint96 stakeAmountAtExpiry; // nxm total supply is 6.7e24 and uint96.max is 7.9e28
    uint128 stakeSharesSupplyAtExpiry;
  }

  struct Deposit {
    uint96 lastAccNxmPerRewardShare;
    uint96 pendingRewards;
    uint128 stakeShares;
    uint128 rewardsShares;
  }

  struct StakedProduct {
    uint16 lastEffectiveWeight;
    uint8 targetWeight;
    uint96 targetPrice;
    uint96 bumpedPrice;
    uint32 bumpedPriceUpdateTime;
  }

  function initialize(
    address _manager,
    bool isPrivatePool,
    uint initialPoolFee,
    uint maxPoolFee,
    ProductInitializationParams[] calldata params,
    uint _poolId,
    string memory ipfsDescriptionHash
  ) external;

  function processExpirations(bool updateUntilCurrentTimestamp) external;

  function requestAllocation(
    uint amount,
    uint previousPremium,
    AllocationRequest calldata request
  ) external returns (uint premium, uint allocationId);

  function burnStake(uint amount, uint coverAmount, AllocationRequest calldata request) external;

  function depositTo(
    uint amount,
    uint trancheId,
    uint requestTokenId,
    address destination
  ) external returns (uint tokenId);

  function withdraw(
    uint tokenId,
    bool withdrawStake,
    bool withdrawRewards,
    uint[] memory trancheIds
  ) external returns (uint withdrawnStake, uint withdrawnRewards);

  function setPoolFee(uint newFee) external;

  function setPoolPrivacy(bool isPrivatePool) external;

  function setProducts(StakedProductParam[] memory params) external;

  function manager() external view returns (address);

  function getActiveStake() external view returns (uint);

  function getProductStake(uint productId, uint coverExpirationDate) external view returns (uint);

  function getFreeProductStake(uint productId, uint coverExpirationDate) external view returns (uint);

  function getAllocatedProductStake(uint productId) external view returns (uint);

    /* ========== EVENTS ========== */

  event StakeDeposited(address indexed user, uint256 amount, uint256 trancheId, uint256 tokenId);

  event DepositExtended(address indexed user, uint256 tokenId, uint256 initialTrancheId, uint256 newTrancheId, uint256 topUpAmount);

  event PoolPrivacyChanged(address indexed manager, bool isPrivate);

  event PoolFeeChanged(address indexed manager, uint newFee);

  event PoolDescriptionSet(uint poolId, string ipfsDescriptionHash);

  event Withdraw(address indexed src, uint indexed tokenId, uint tranche, uint amountStakeWithdrawn, uint amountRewardsWithdrawn);

  // Auth
  error OnlyCoverContract();
  error OnlyManager();
  error PrivatePool();
  error SystemPaused();

  // Fees
  error PoolFeeExceedsMax();
  error MaxPoolFeeAbove100();

  // Voting
  error NxmIsLockedForGovernanceVote();
  error ManagerNxmIsLockedForGovernanceVote();

  // Deposit
  error InsufficientDepositAmount();
  error RewardRatioTooHigh();

  // Staking NFTs
  error InvalidTokenId();
  error NotTokenOwnerOrApproved();

  // Tranche & capacity
  error NewTrancheEndsBeforeInitialTranche();
  error RequestedTrancheIsNotYetActive();
  error RequestedTrancheIsExpired();
  error InsufficientCapacity();

  // Products & weights
  error PoolNotAllowedForThisProduct();
  error MustSetPriceForNewProducts();
  error MustSetWeightForNewProducts();
  error TargetPriceTooHigh();
  error TargetPriceBelowMin();
  error TargetWeightTooHigh();
  error MustRecalculateEffectiveWeight();
  error TotalTargetWeightExceeded();
  error TotalEffectiveWeightExceeded();
}

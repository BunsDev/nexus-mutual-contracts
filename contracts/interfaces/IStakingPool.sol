// SPDX-License-Identifier: GPL-3.0-only

pragma solidity >=0.5.0;

import "@openzeppelin/contracts-v4/token/ERC721/IERC721.sol";

/* structs for io */

struct AllocationRequest {
  uint productId;
  uint coverId;
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

struct WithdrawRequest {
  uint tokenId;
  bool withdrawStake;
  bool withdrawRewards;
  uint[] trancheIds;
}

struct DepositRequest {
  uint amount;
  uint trancheId;
  uint tokenId;
  address destination;
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
    uint /* uint128 */ stakeShares;
    uint /* uint128 */ rewardsShares;
  }

  struct ExpiredTranche {
    uint accNxmPerRewardShareAtExpiry;
    uint stakeAmountAtExpiry;
    uint stakeShareSupplyAtExpiry;
  }

  struct Deposit {
    uint lastAccNxmPerRewardShare;
    uint pendingRewards;
    uint stakeShares;
    uint rewardsShares;
  }

  struct StakedProduct {
    uint16 lastEffectiveWeight;
    uint8 targetWeight;
    uint96 targetPrice;
    uint96 nextPrice;
    uint32 nextPriceUpdateTime;
  }

  struct RewardBucket {
    // TODO: pack 4 buckets in a slot. uint64 can hold a max of ~1593798 nxm rewards per day
    uint rewardPerSecondCut;
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

  function operatorTransfer(address from, address to, uint[] calldata tokenIds) external;

  function processExpirations(bool updateUntilCurrentTimestamp) external;

  function requestAllocation(
    uint amount,
    uint previousPremium,
    AllocationRequest calldata request
  ) external returns (uint premium);

  function burnStake(uint amount) external;

  function depositTo(DepositRequest[] memory requests) external returns (uint[] memory tokenIds);

  function withdraw(
    WithdrawRequest[] memory params
  ) external returns (uint stakeToWithdraw, uint rewardsToWithdraw);

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
}

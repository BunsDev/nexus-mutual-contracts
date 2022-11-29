// SPDX-License-Identifier: GPL-3.0-only

pragma solidity >=0.5.0;

import "./IStakingPool.sol";

/* ========== DATA STRUCTURES ========== */

enum ClaimMethod {
  IndividualClaims,
  YieldTokenIncidents
}

// Basically CoverStatus from QuotationData.sol but with the extra Migrated status to avoid
// polluting Cover.sol state layout with new status variables.
enum LegacyCoverStatus {
  Active,
  ClaimAccepted,
  ClaimDenied,
  CoverExpired,
  ClaimSubmitted,
  Requested,
  Migrated
}

enum CoverUintParams {
  globalCapacityRatio,
  globalRewardsRatio,
  coverAssetsFallback
}

struct PoolAllocationRequest {
  uint40 poolId;
  uint coverAmountInAsset;
}

struct PoolAllocation {
  uint40 poolId;
  uint96 coverAmountInNXM;
}

struct CoverData {
  uint24 productId;
  uint8 coverAsset;
  uint96 amountPaidOut;
}

struct CoverSegment {
  uint96 amount;
  uint32 start;
  uint32 period;  // seconds
  uint16 gracePeriodInDays;
  uint24 globalRewardsRatio;
}

struct BuyCoverParams {
  uint coverId;
  address owner;
  uint24 productId;
  uint8 coverAsset;
  uint96 amount;
  uint32 period;
  uint maxPremiumInAsset;
  uint8 paymentAsset;
  uint16 commissionRatio;
  address commissionDestination;
  string ipfsData;
}

struct ProductBucket {
  uint96 coverAmountExpiring;
}

struct Product {
  uint16 productType;
  address yieldTokenAddress;
  // cover assets bitmap. each bit represents whether the asset with
  // the index of that bit is enabled as a cover asset for this product
  uint32 coverAssets;
  uint16 initialPriceRatio;
  uint16 capacityReductionRatio;
  bool isDeprecated;
  bool fixedPricing;
}

struct ProductParam {
  uint productId;
  string ipfsMetadata;
  Product product;
  uint[] allowedPools;
}

struct ProductType {
  uint8 claimMethod;
  uint16 gracePeriodInDays;
}

struct ProductTypeParam {
  uint productTypeId;
  string ipfsMetadata;
  ProductType productType;
}

interface ICover {

  /* ========== VIEWS ========== */

  function coverData(uint coverId) external view returns (CoverData memory);

  function coverSegmentsCount(uint coverId) external view returns (uint);

  function coverSegments(uint coverId, uint segmentId) external view returns (CoverSegment memory);

  function products(uint id) external view returns (Product memory);

  function productTypes(uint id) external view returns (ProductType memory);

  function isAssetSupported(uint32 coverAssetsBitMap, uint8 coverAsset) external view returns (bool);

  function stakingPool(uint index) external view returns (IStakingPool);

  function stakingPoolCount() external view returns (uint64);

  function productsCount() external view returns (uint);

  function activeCoverAmountCommitted() external view returns (bool);

  function MAX_COVER_PERIOD() external view returns (uint);

  function totalActiveCoverInAsset(uint24 coverAsset) external view returns (uint);

  function globalCapacityRatio() external view returns (uint24);

  function getPriceAndCapacityRatios(uint[] calldata productIds) external view returns (
    uint _globalCapacityRatio,
    uint _globalMinPriceRatio,
    uint[] memory _initialPriceRatios,
    uint[] memory _capacityReductionRatios
  );

  /* === MUTATIVE FUNCTIONS ==== */

  function migrateCovers(uint[] calldata coverIds, address newOwner) external returns (uint[] memory newCoverIds);

  function migrateCoverFromOwner(uint coverId, address fromOwner, address newOwner) external;

  function buyCover(
    BuyCoverParams calldata params,
    PoolAllocationRequest[] calldata coverChunkRequests
  ) external payable returns (uint /*coverId*/);

  function setProductTypes(ProductTypeParam[] calldata productTypes) external;

  function setProducts(ProductParam[] calldata params) external;

  function burnStake(
    uint coverId,
    uint segmentId,
    uint amount
  ) external returns (address /*owner*/);

  function coverNFT() external returns (address);

  function transferCovers(address from, address to, uint256[] calldata coverIds) external;

  function createStakingPool(
    address manager,
    bool isPrivatePool,
    uint initialPoolFee,
    uint maxPoolFee,
    ProductInitializationParams[] calldata params,
    uint depositAmount,
    uint trancheId,
    string calldata ipfsDescriptionHash
  ) external returns (address stakingPoolAddress);

  function isValidFixedPricingPool(uint productId, uint poolId) external returns (bool);

  /* ========== EVENTS ========== */

  event StakingPoolCreated(
    address stakingPoolAddress,
    uint poolId,
    address manager,
    address stakingPoolImplementation
  );
  event ProductSet(uint id, string ipfsMetadata);
  event ProductTypeSet(uint id, string ipfsMetadata);
  event CoverEdited(uint indexed coverId, uint indexed productId, uint indexed segmentId, address buyer, string ipfsMetadata);
  event CoverMigrated(uint oldCoverId, address fromOwner, address newOwner, uint newCoverId);
}

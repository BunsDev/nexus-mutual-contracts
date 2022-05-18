// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.9;

import "@openzeppelin/contracts-v4/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts-v4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-v4/proxy/beacon/UpgradeableBeacon.sol";

import "./CoverUtilsLib.sol";
import "./MinimalBeaconProxy.sol";

import "../../utils/SafeUintCast.sol";
import "../../interfaces/ICover.sol";
import "../../interfaces/IStakingPool.sol";
import "../../interfaces/IQuotationData.sol";
import "../../interfaces/IPool.sol";
import "../../abstract/MasterAwareV2.sol";
import "../../interfaces/IMemberRoles.sol";
import "../../interfaces/ICoverNFT.sol";
import "../../interfaces/IProductsV1.sol";
import "../../interfaces/IMCR.sol";
import "../../interfaces/ITokenController.sol";
import "../../interfaces/IStakingPoolBeacon.sol";


contract Cover is ICover, MasterAwareV2, IStakingPoolBeacon {
  using SafeERC20 for IERC20;

  /* === CONSTANTS ==== */

  uint public constant BUCKET_SIZE = 7 days;
  uint public constant REWARD_DENOMINATOR = 2;

  uint public constant PRICE_DENOMINATOR = 10000;
  uint public constant COMMISSION_DENOMINATOR = 10000;
  uint public constant CAPACITY_REDUCTION_DENOMINATOR = 10000;
  uint public constant GLOBAL_CAPACITY_DENOMINATOR = 10_000;

  uint public constant BURN_DENOMINATOR = 1e18;

  uint public constant MAX_COVER_PERIOD = 365 days;
  uint public constant MIN_COVER_PERIOD = 30 days;

  uint public constant MAX_COMMISSION_RATIO = 2500; // 25%

  uint public constant GLOBAL_MIN_PRICE_RATIO = 100; // 1%

  IQuotationData internal immutable quotationData;
  IProductsV1 internal immutable productsV1;
  address public immutable override coverNFT;

  /* Staking pool creation */
  bytes32 public immutable stakingPoolProxyCodeHash;
  address public immutable stakingPoolImplementation;


  /* ========== STATE VARIABLES ========== */

  Product[] internal _products;
  ProductType[] internal _productTypes;

  CoverData[] private _coverData;
  mapping(uint => mapping(uint => PoolAllocation[])) public coverSegmentAllocations;

  /*
    Each Cover has an array of segments. A new segment is created everytime a cover is edited to
    deliniate the different cover periods.
  */
  mapping(uint => CoverSegment[]) private _coverSegments;


  uint24 public globalCapacityRatio;
  uint24 public globalRewardsRatio;
  uint64 public override stakingPoolCount;

  /*
    bit map representing which assets are globally supported for paying for and for paying out covers
    If the the bit at position N is 1 it means asset with index N is supported.this
    Eg. coverAssetsFallback = 3 (in binary 11) means assets at index 0 and 1 are supported.
  */
  uint32 public coverAssetsFallback;

  // Global active cover amount per asset.
  mapping(uint24 => uint) public override totalActiveCoverInAsset;

  bool public coverAmountTrackingEnabled;
  bool public activeCoverAmountCommitted;


  /* ========== CONSTRUCTOR ========== */

  constructor(
    IQuotationData _quotationData,
    IProductsV1 _productsV1,
    address _coverNFT,
    address _stakingPoolImplementation
  ) {

    // initialize immutable fields only
    quotationData = _quotationData;
    productsV1 = _productsV1;
    coverNFT = _coverNFT;

    stakingPoolProxyCodeHash = CoverUtilsLib.calculateProxyCodeHash();
    stakingPoolImplementation = _stakingPoolImplementation;
  }

  /* === MUTATIVE FUNCTIONS ==== */


  /// @dev Migrates covers from V1. Meant to be used by Claims.sol and Gateway.sol to allow the
  /// users of distributor contracts to migrate their NFTs.
  ///
  /// @param coverId     V1 cover identifier
  /// @param fromOwner   The address from where this function is called that needs to match the
  /// @param toNewOwner  The address for which the V2 cover NFT is minted
  function migrateCoverFromOwner(
    uint coverId,
    address fromOwner,
    address toNewOwner
  ) external override onlyInternal {
    _migrateCoverFromOwner(coverId, fromOwner, toNewOwner);
  }

  /// @dev Migrates covers from V1
  ///
  /// @param coverId     V1 cover identifier
  /// @param fromOwner   The address from where this function is called that needs to match the
  /// @param toNewOwner  The address for which the V2 cover NFT is minted
  function _migrateCoverFromOwner(
    uint coverId,
    address fromOwner,
    address toNewOwner
  ) internal {

    CoverUtilsLib.migrateCoverFromOwner(
      CoverUtilsLib.MigrateParams(
        coverId,
        fromOwner,
        toNewOwner,
        ICoverNFT(coverNFT),
        quotationData,
        tokenController(),
        productsV1
      ),
      _products,
      _productTypes,
      _coverData,
      _coverSegments
    );
  }

  /// @dev Migrates covers from V1. Meant to be used by EOA Nexus Mutual members
  ///
  /// @param coverIds    Legacy (V1) cover identifiers
  /// @param toNewOwner  The address for which the V2 cover NFT is minted
  function migrateCovers(uint[] calldata coverIds, address toNewOwner) external override {
    for (uint i = 0; i < coverIds.length; i++) {
      _migrateCoverFromOwner(coverIds[i], msg.sender, toNewOwner);
    }
  }

  function buyCover(
    BuyCoverParams memory params,
    PoolAllocationRequest[] memory allocationRequests
  ) external payable override onlyMember returns (uint /*coverId*/) {

    require(_products.length > params.productId, "Cover: Product not found");
    Product memory product = _products[params.productId];
    require(product.initialPriceRatio != 0, "Cover: Product not initialized");
    require(
      isAssetSupported(product.coverAssets, params.payoutAsset),
      "Cover: Payout asset is not supported"
    );
    require(params.period >= MIN_COVER_PERIOD, "Cover: Cover period is too short");
    require(params.period <= MAX_COVER_PERIOD, "Cover: Cover period is too long");
    require(params.commissionRatio <= MAX_COMMISSION_RATIO, "Cover: Commission rate is too high");

    uint totalPremiumInNXM = _buyCover(params, _coverData.length, allocationRequests);

    IPool _pool = pool();
    uint tokenPriceInPaymentAsset = _pool.getTokenPrice(params.paymentAsset);
    (, uint8 paymentAssetDecimals) = _pool.coverAssets(params.paymentAsset);

    uint premiumInPaymentAsset = totalPremiumInNXM * (tokenPriceInPaymentAsset / 10 ** paymentAssetDecimals);
    require(premiumInPaymentAsset <= params.maxPremiumInAsset, "Cover: Price exceeds maxPremiumInAsset");

    if (params.payWithNXM) {
      retrieveNXMPayment(totalPremiumInNXM, params.commissionRatio, params.commissionDestination);
    } else {
      retrievePayment(
        premiumInPaymentAsset,
        params.paymentAsset,
        params.commissionRatio,
        params.commissionDestination
      );
    }

    // push the newly created cover
    _coverData.push(CoverData(
        params.productId,
        params.payoutAsset,
        0 // amountPaidOut
      ));

    uint coverId = _coverData.length - 1;
    ICoverNFT(coverNFT).safeMint(params.owner, coverId);

    // Enable this when cover amount tracking is necessary
    if (coverAmountTrackingEnabled) {
      totalActiveCoverInAsset[params.payoutAsset] += params.amount;
    }

    emit CoverBought(coverId, params.productId, 0, msg.sender);
    return coverId;
  }

  function _buyCover(
    BuyCoverParams memory params,
    uint coverId,
    PoolAllocationRequest[] memory allocationRequests
  ) internal returns (uint totalPremiumInNXM) {

    // convert to NXM amount
    uint nxmPriceInPayoutAsset = pool().getTokenPrice(params.payoutAsset);
    uint remainderAmountInNXM = 0;
    uint totalCoverAmountInNXM = 0;

    uint _coverSegmentsCount = _coverSegments[coverId].length;

    for (uint i = 0; i < allocationRequests.length; i++) {

      uint requestedCoverAmountInNXM
        = allocationRequests[i].coverAmountInAsset * 1e18 / nxmPriceInPayoutAsset + remainderAmountInNXM;

      (uint coveredAmountInNXM, uint premiumInNXM) = allocateCapacity(
        params,
        stakingPool(allocationRequests[i].poolId),
        requestedCoverAmountInNXM
      );

      remainderAmountInNXM = requestedCoverAmountInNXM - coveredAmountInNXM;
      totalCoverAmountInNXM += coveredAmountInNXM;
      totalPremiumInNXM += premiumInNXM;

      coverSegmentAllocations[coverId][_coverSegmentsCount].push(
        PoolAllocation(allocationRequests[i].poolId, SafeUintCast.toUint96(coveredAmountInNXM), SafeUintCast.toUint96(premiumInNXM))
      );
    }

    // priceRatio is normalized on a per year basis (eg. 1.5% per year)
    uint16 priceRatio = SafeUintCast.toUint16(
          divRound(totalPremiumInNXM * PRICE_DENOMINATOR * MAX_COVER_PERIOD / params.period, totalCoverAmountInNXM)
    );

    _coverSegments[coverId].push(CoverSegment(
        SafeUintCast.toUint96(totalCoverAmountInNXM * nxmPriceInPayoutAsset / 1e18), // amount
        uint32(block.timestamp + 1), // start
        SafeUintCast.toUint32(params.period), // period
        priceRatio,
        false // expired
      ));

    return totalPremiumInNXM;
  }

  function allocateCapacity(
    BuyCoverParams memory params,
    IStakingPool _stakingPool,
    uint amount
  ) internal returns (uint coveredAmountInNXM, uint premiumInNXM) {

    Product memory product = _products[params.productId];
    uint gracePeriod = _productTypes[product.productType].gracePeriodInDays * 1 days;

    // TODO: correctly calculate the capacity
    uint allocation = amount * globalCapacityRatio;

    if (true) {
      // wrapped in if(true) to avoid the compiler warning about unreachable code
      revert("capacity calculation: not implemented");
    }

    return _stakingPool.allocateStake(
      params.productId,
      params.period,
      gracePeriod,
      allocation,
      globalRewardsRatio
    );
  }

  function editCover(
    uint coverId,
    BuyCoverParams memory buyCoverParams,
    PoolAllocationRequest[] memory poolAllocations
  ) external payable onlyMember {

    CoverData memory cover = _coverData[coverId];
    uint lastCoverSegmentIndex = _coverSegments[coverId].length - 1;
    CoverSegment memory lastCoverSegment = coverSegments(coverId, lastCoverSegmentIndex);

    require(lastCoverSegment.start + lastCoverSegment.period > block.timestamp, "Cover: cover expired");
    require(buyCoverParams.period < MAX_COVER_PERIOD, "Cover: Cover period is too long");
    require(buyCoverParams.commissionRatio <= MAX_COMMISSION_RATIO, "Cover: Commission rate is too high");

    // Override cover specific parameters
    buyCoverParams.payoutAsset = cover.payoutAsset;
    buyCoverParams.productId = cover.productId;

    uint refundInCoverAsset = 0;
    if (!lastCoverSegment.expired) {
      uint32 remainingPeriod = lastCoverSegment.start + lastCoverSegment.period - uint32(block.timestamp);

      PoolAllocation[] storage originalPoolAllocations = coverSegmentAllocations[coverId][lastCoverSegmentIndex];

      {
        uint originalPoolAllocationsCount = originalPoolAllocations.length;

        // rollback previous cover
        for (uint i = 0; i < originalPoolAllocationsCount; i++) {
          stakingPool(originalPoolAllocations[i].poolId).deallocateStake(
            cover.productId,
            lastCoverSegment.start,
            lastCoverSegment.period,
            originalPoolAllocations[i].coverAmountInNXM,
            originalPoolAllocations[i].premiumInNXM / REWARD_DENOMINATOR
          );
          originalPoolAllocations[i].premiumInNXM *= (lastCoverSegment.period - remainingPeriod) / lastCoverSegment.period;
        }
      }

      refundInCoverAsset = lastCoverSegment.priceRatio
        * lastCoverSegment.amount
        / PRICE_DENOMINATOR
        * remainingPeriod
        / MAX_COVER_PERIOD;

      // edit cover so it ends at the current block
      lastCoverSegment.period = lastCoverSegment.period - remainingPeriod;
    }

    uint totalPremiumInNXM = _buyCover(buyCoverParams, coverId, poolAllocations);

    handlePaymentAndRefund(buyCoverParams, totalPremiumInNXM, refundInCoverAsset);

    // update total cover amount for asset by decreasing the previous amount and adding the new amount
    if (coverAmountTrackingEnabled) {
       totalActiveCoverInAsset[cover.payoutAsset] =
        totalActiveCoverInAsset[cover.payoutAsset] - lastCoverSegment.amount + buyCoverParams.amount;
    }

    emit CoverEdited(coverId, cover.productId, lastCoverSegmentIndex + 1, msg.sender);
  }

  function handlePaymentAndRefund(
    BuyCoverParams memory buyCoverParams,
    uint totalPremiumInNXM,
    uint refundInCoverAsset
  ) internal {

    IPool _pool = pool();

    // calculate refundValue in NXM
    uint refundInNXM = refundInCoverAsset * 1e18 / _pool.getTokenPrice(buyCoverParams.payoutAsset);

    if (refundInNXM >= totalPremiumInNXM) {
      // no extra charge for the user
      return;
    }

    uint tokenPriceInPaymentAsset = _pool.getTokenPrice(buyCoverParams.paymentAsset);
    (, uint8 paymentAssetDecimals) = _pool.coverAssets(buyCoverParams.paymentAsset);

    uint premiumInPaymentAsset = totalPremiumInNXM * (tokenPriceInPaymentAsset / 10 ** paymentAssetDecimals);

    require(premiumInPaymentAsset <= buyCoverParams.maxPremiumInAsset, "Cover: Price exceeds maxPremiumInAsset");

    if (buyCoverParams.payWithNXM) {
      // requires NXM allowance
      retrieveNXMPayment(
        totalPremiumInNXM - refundInNXM,
        buyCoverParams.commissionRatio,
        buyCoverParams.commissionDestination
      );
      return;
    }

    // calculate the refund value in the payment asset
    uint refundInPaymentAsset = refundInNXM * (tokenPriceInPaymentAsset / 10 ** paymentAssetDecimals);

    // retrieve extra required payment
    retrievePayment(
      premiumInPaymentAsset - refundInPaymentAsset,
      buyCoverParams.paymentAsset,
      buyCoverParams.commissionRatio,
      buyCoverParams.commissionDestination
    );
  }

  // TODO: implement properly. we need the staking interface for burning.
  function performPayoutBurn(
    uint coverId,
    uint segmentId,
    uint burnAmount
  ) external onlyInternal override returns (address /* owner */) {

    ICoverNFT coverNFTContract = ICoverNFT(coverNFT);
    address owner = coverNFTContract.ownerOf(coverId);

    CoverData storage cover = _coverData[coverId];
    cover.amountPaidOut += SafeUintCast.toUint96(burnAmount);

    CoverSegment memory segment = coverSegments(coverId, segmentId);
    PoolAllocation[] storage allocations = coverSegmentAllocations[coverId][segmentId];

    uint allocationCount = allocations.length;
    for (uint i = 0; i < allocationCount; i++) {

      PoolAllocation storage allocation = allocations[i];
      IStakingPool _stakingPool = stakingPool(allocation.poolId);

      uint nxmBurned = allocation.coverAmountInNXM
        * burnAmount / segment.amount
        * GLOBAL_CAPACITY_DENOMINATOR / globalCapacityRatio;

      _stakingPool.burnStake(cover.productId, segment.start, segment.period, nxmBurned);

      allocation.coverAmountInNXM -= SafeUintCast.toUint96(nxmBurned);
    }

    return owner;
  }

  function transferCovers(address from, address to, uint256[] calldata coverIds) external override {
    require(
      msg.sender == internalContracts[uint(ID.MR)],
      "Cover: Only MemberRoles is permitted to use operator transfer"
    );

    ICoverNFT coverNFTContract = ICoverNFT(coverNFT);
    for (uint256 i = 0; i < coverIds.length; i++) {
      coverNFTContract.operatorTransferFrom(from, to, coverIds[i]);
    }
  }


  function retrievePayment(
    uint premium,
    uint8 paymentAsset,
    uint16 commissionRatio,
    address commissionDestination
  ) internal {

    // add commission
    uint commission = premium * commissionRatio / COMMISSION_DENOMINATOR;

    if (paymentAsset == 0) {

      uint premiumWithCommission = premium + commission;
      require(msg.value >= premiumWithCommission, "Cover: Insufficient ETH sent");

      uint remainder = msg.value - premiumWithCommission;

      if (remainder > 0) {
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, /* data */) = address(msg.sender).call{value: remainder}("");
        require(ok, "Cover: Returning ETH remainder to sender failed.");
      }

      // send commission
      if (commission > 0) {
        (bool ok, /* data */) = address(commissionDestination).call{value: commission}("");
        require(ok, "Cover: Sending ETH to commission destination failed.");
      }

      return;
    }

    IPool _pool = pool();

    (
    address payoutAsset,
    /*uint8 decimals*/
    ) = _pool.coverAssets(paymentAsset);

    IERC20 token = IERC20(payoutAsset);
    token.safeTransferFrom(msg.sender, address(_pool), premium);

    if (commission > 0) {
      token.safeTransferFrom(msg.sender, commissionDestination, commission);
    }
  }

  function retrieveNXMPayment(uint price, uint commissionRatio, address commissionDestination) internal {

    ITokenController _tokenController = tokenController();

    if (commissionRatio > 0) {
      uint commission = price * commissionRatio / COMMISSION_DENOMINATOR;
      // transfer the commission to the commissionDestination; reverts if commissionDestination is not a member
      _tokenController.operatorTransfer(msg.sender, commissionDestination, commission);
    }

    _tokenController.burnFrom(msg.sender, price);
  }

  /* ========== Staking Pool creation ========== */

  function createStakingPool(
    address manager,
    ProductInitializationParams[] calldata params,
    uint depositAmount,
    uint groupId
  ) external returns (address stakingPoolAddress) {

    emit StakingPoolCreated(stakingPoolAddress, manager, stakingPoolImplementation);

    // [todo] add a fee parameter for the staking pool once its implemented
    // [todo] handle the creation of NFT 0 which is the default NFT owned by the pool manager
    return CoverUtilsLib.createStakingPool(manager, stakingPoolCount++, params, depositAmount, groupId);
  }

  function stakingPool(uint index) public view returns (IStakingPool) {
    return CoverUtilsLib.stakingPool(index, stakingPoolProxyCodeHash);
  }

  function coverData(uint coverId) external override view returns (CoverData memory) {
    return _coverData[coverId];
  }

  function coverSegments(
    uint coverId,
    uint segmentId
  ) public override view returns (CoverSegment memory) {
    CoverSegment memory segment = _coverSegments[coverId][segmentId];
    uint96 amountPaidOut = _coverData[coverId].amountPaidOut;
    segment.amount = segment.amount >= amountPaidOut
      ? segment.amount - amountPaidOut
      : 0;
    return segment;
  }

  function products(uint id) external override view returns (Product memory) {
    return _products[id];
  }

  function productTypes(uint id) external override view returns (ProductType memory) {
    return _productTypes[id];
  }

  function coverSegmentsCount(uint coverId) external override view returns (uint) {
    return _coverSegments[coverId].length;
  }

  function productsCount() external override view returns (uint) {
    return _products.length;
  }

  /*========== COVER EXPIRATION ========== */

  function expireCovers(uint[] calldata coverIds) external {
    for (uint i = 0; i < coverIds.length; i++) {
      expireCover(coverIds[i]);
    }
  }

  function expireCover(uint coverId) public {

    require(coverAmountTrackingEnabled, "Cover expiring not enabled");


    uint lastCoverSegmentIndex = _coverSegments[coverId].length - 1;
    CoverSegment memory lastCoverSegment = coverSegments(coverId, lastCoverSegmentIndex);

    require(!lastCoverSegment.expired, "Cover: Cover is already expired.");

    if (lastCoverSegment.period + lastCoverSegment.start > block.timestamp) {

      _coverSegments[coverId][lastCoverSegmentIndex].expired = true;

      CoverData memory cover = _coverData[coverId];
      totalActiveCoverInAsset[cover.payoutAsset] -= lastCoverSegment.amount;

      emit CoverExpired(coverId, lastCoverSegmentIndex);
    }
  }

  /* ========== PRODUCT CONFIGURATION ========== */

  function setGlobalCapacityRatio(uint24 _globalCapacityRatio) external onlyGovernance {
    globalCapacityRatio = _globalCapacityRatio;
  }

  function setGlobalRewardsRatio(uint24 _globalRewardsRatio) external onlyGovernance {
    globalRewardsRatio = _globalRewardsRatio;
  }

  function setInitialPrices(
    uint[] calldata productIds,
    uint16[] calldata initialPriceRatios
  ) external override onlyAdvisoryBoard {
    require(productIds.length == initialPriceRatios.length, "Cover: Array lengths must not be different");
    for (uint i = 0; i < productIds.length; i++) {
      require(initialPriceRatios[i] >= GLOBAL_MIN_PRICE_RATIO, "Cover: Initial price must be greater than the global min price");
      _products[productIds[i]].initialPriceRatio = initialPriceRatios[i];
    }
  }

  function setCapacityReductionRatio(uint productId, uint16 reduction) external onlyAdvisoryBoard {
    require(reduction <= CAPACITY_REDUCTION_DENOMINATOR, "Cover: LTADeduction must be less than or equal to 100%");
    _products[productId].capacityReductionRatio = reduction;
  }

  function addProducts(
    Product[] calldata newProducts,
    string[] calldata ipfsMetadata
  ) external override onlyAdvisoryBoard {
    uint initialProductsCount = _products.length;
    for (uint i = 0; i < newProducts.length; i++) {
      _products.push(newProducts[i]);
      emit ProductUpserted(initialProductsCount + i, ipfsMetadata[i]);
    }
  }

  function editProductsIpfsMetadata(
    uint[] calldata productIds,
    string[] calldata ipfsMetadata
  ) external override onlyAdvisoryBoard {
    for (uint i = 0; i < productIds.length; i++) {
      emit ProductUpserted(productIds[i], ipfsMetadata[i]);
    }
  }

  function addProductTypes(
    ProductType[] calldata newProductTypes,
    string[] calldata ipfsMetadata
  ) external override onlyAdvisoryBoard {
    uint initialProuctTypesCount = _productTypes.length;
    for (uint i = 0; i < newProductTypes.length; i++) {
      _productTypes.push(newProductTypes[i]);
      emit ProductTypeUpserted(initialProuctTypesCount + i, ipfsMetadata[i]);
    }
  }

  function setCoverAssetsFallback(uint32 _coverAssetsFallback) external override onlyGovernance {
    coverAssetsFallback = _coverAssetsFallback;
  }

  /* ========== ACTIVE COVER AMOUNT TRACKING ========== */

  function enableActiveCoverAmountTracking(uint24[] memory assetIds, uint[] memory activeCoverAmountsForAssets) external onlyEmergencyAdmin {
    require(!activeCoverAmountCommitted, "Cover: activeCoverAmountCommitted = true");

    require(assetIds.length == activeCoverAmountsForAssets.length, "Cover: Array lengths must not be different");
    if (!coverAmountTrackingEnabled) {
      coverAmountTrackingEnabled = true;
    }


    for (uint i = 0; i < assetIds.length; i++) {
      totalActiveCoverInAsset[assetIds[i]] = activeCoverAmountsForAssets[i];
    }
  }

  function commitActiveCoverAmounts() external onlyEmergencyAdmin {
    require(!activeCoverAmountCommitted, "Cover: activeCoverAmountCommitted = true");
    activeCoverAmountCommitted = true;
  }

  /* ========== HELPERS ========== */

  function isAssetSupported(uint32 payoutAssetsBitMap, uint8 payoutAsset) public view override returns (bool) {

    if (payoutAssetsBitMap == 0) {
      return (1 << payoutAsset) & coverAssetsFallback > 0;
    }
    return (1 << payoutAsset) & payoutAssetsBitMap > 0;
  }

  /* ========== VIEWS ========== */

  function getPoolAllocationPriceParametersForProduct(uint poolId, uint productId) public view returns (
    PoolAllocationPriceParameters memory params
  ) {
    IStakingPool _pool = stakingPool(poolId);
    Product memory product = _products[productId];


    uint[] memory staked;
    (params.activeCover, staked, params.lastBasePrice, params.targetPrice) = _pool.getPriceParameters(productId);
    params.capacities = new uint[](staked.length);
    for (uint i = 0; i < staked.length; i++) {
      params.capacities[i] = calculateCapacity(
        staked[i],
        product.capacityReductionRatio
      );
    }

    params.initialPriceRatio = product.initialPriceRatio;
  }

  struct PoolAllocationPriceParameters {
    uint activeCover;
    uint[] capacities;
    uint initialPriceRatio;
    uint lastBasePrice;
    uint targetPrice;
  }

  function getPoolAllocationPriceParameters(uint poolId) public view returns (
    PoolAllocationPriceParameters[] memory params
  ) {
    uint count = _products.length;
    params = new PoolAllocationPriceParameters[](count);

    for (uint i = 0; i < count; i++) {
      params[i] = getPoolAllocationPriceParametersForProduct(poolId, i);
    }
  }

  /* ========== CAPACITY CALCULATION ========== */

  function calculateCapacity(
    uint staked,
    uint capacityReductionRatio
  ) internal view returns (uint) {
    return staked *
    globalCapacityRatio *
    (CAPACITY_REDUCTION_DENOMINATOR - capacityReductionRatio) /
    GLOBAL_CAPACITY_DENOMINATOR /
    CAPACITY_REDUCTION_DENOMINATOR;
  }

  /* ========== UTILS ========== */

  function divRound(uint a, uint b) private pure returns (uint) {
    return (a + b / 2) / b;
  }

  /* ========== DEPENDENCIES ========== */

  function pool() internal view returns (IPool) {
    return IPool(internalContracts[uint(ID.P1)]);
  }

  function tokenController() internal view returns (ITokenController) {
    return ITokenController(internalContracts[uint(ID.TC)]);
  }

  function memberRoles() internal view returns (IMemberRoles) {
    return IMemberRoles(internalContracts[uint(ID.MR)]);
  }

  function mcr() internal view returns (IMCR) {
    return IMCR(internalContracts[uint(ID.MC)]);
  }

  function changeDependentContractAddress() external override {
    master = INXMMaster(master);
    internalContracts[uint(ID.TC)] = master.getLatestAddress("TC");
    internalContracts[uint(ID.P1)] = master.getLatestAddress("P1");
    internalContracts[uint(ID.MR)] = master.getLatestAddress("MR");
    internalContracts[uint(ID.MC)] = master.getLatestAddress("MC");
  }
}

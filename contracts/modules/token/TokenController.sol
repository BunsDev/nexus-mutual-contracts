// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.9;

import "../../utils/SafeUintCast.sol";
import "../../abstract/LegacyMasterAware.sol";
import "../../interfaces/ILegacyClaimsData.sol";
import "../../interfaces/INXMToken.sol";
import "../../interfaces/IPooledStaking.sol";
import "../../interfaces/ITokenController.sol";
import "../../interfaces/IAssessment.sol";
import "../../interfaces/IGovernance.sol";
import "../../interfaces/IQuotationData.sol";
import "../../interfaces/INXMMaster.sol";
import "./external/LockHandler.sol";

contract TokenController is ITokenController, LockHandler, LegacyMasterAware {
  using SafeUintCast for uint;
  IQuotationData public immutable quotationData;
  address public immutable claimsReward;

  INXMToken public override token;
  IPooledStaking public pooledStaking;
  IAssessment public assessment;
  IGovernance public governance;

  // coverId => CoverInfo
  mapping(uint => CoverInfo) public override coverInfo;

  constructor(address quotationDataAddress, address claimsRewardAddress) {
    quotationData = IQuotationData(quotationDataAddress);
    claimsReward = claimsRewardAddress;
  }

  /**
  * @dev Just for interface
  */
  function changeDependentContractAddress() public {
    token = INXMToken(ms.tokenAddress());
    pooledStaking = IPooledStaking(ms.getLatestAddress("PS"));
    assessment = IAssessment(ms.getLatestAddress("AS"));
  }

  /**
   * @dev to change the operator address
   * @param _newOperator is the new address of operator
   */
  function changeOperator(address _newOperator) public override onlyInternal {
    token.changeOperator(_newOperator);
  }

  /**
   * @dev Proxies token transfer through this contract to allow staking when members are locked for voting
   * @param _from   Source address
   * @param _to     Destination address
   * @param _value  Amount to transfer
   */
  function operatorTransfer(
    address _from,
    address _to,
    uint _value
  ) external override onlyInternal returns (bool) {
    token.operatorTransfer(_from, _value);
    token.transfer(_to, _value);
    return true;
  }

  /**
  * @dev Locks a specified amount of tokens against an address,
  *    for a specified reason and time
  * @param _reason The reason to lock tokens
  * @param _amount Number of tokens to be locked
  * @param _time Lock time in seconds
  * @param _of address whose tokens are to be locked
  */
  function lockOf(
    address _of,
    bytes32 _reason,
    uint256 _amount,
    uint256 _time
  ) public override onlyInternal returns (bool) {
    // If tokens are already locked, then functions extendLock or
    // increaseLockAmount should be used to make any changes
    _lock(_of, _reason, _amount, _time);
    return true;
  }

  /**
  * @dev Extends lock for a specified reason and time
  * @param _reason The reason to lock tokens
  * @param _time Lock extension time in seconds
  */
  function extendLockOf(
    address _of,
    bytes32 _reason,
    uint256 _time
  ) public override onlyInternal returns (bool) {
    _extendLock(_of, _reason, _time);
    return true;
  }

  /**
   * @dev burns tokens of an address
   * @param _of is the address to burn tokens of
   * @param amount is the amount to burn
   * @return the boolean status of the burning process
   */
  function burnFrom(address _of, uint amount) public override onlyInternal returns (bool) {
    return token.burnFrom(_of, amount);
  }

  /**
  * @dev Burns locked tokens of a user
  * @param _of address whose tokens are to be burned
  * @param _reason lock reason for which tokens are to be burned
  * @param _amount amount of tokens to burn
  */
  function burnLockedTokens(
    address _of,
    bytes32 _reason,
    uint256 _amount
  ) public override onlyInternal {
    _burnLockedTokens(_of, _reason, _amount);
  }

  /**
  * @dev reduce lock duration for a specified reason and time
  * @param _of The address whose tokens are locked
  * @param _reason The reason to lock tokens
  * @param _time Lock reduction time in seconds
  */
  function reduceLock(address _of, bytes32 _reason, uint256 _time) public override onlyInternal {
    _reduceLock(_of, _reason, _time);
  }

  /**
  * @dev Released locked tokens of an address locked for a specific reason
  * @param _of address whose tokens are to be released from lock
  * @param _reason reason of the lock
  * @param _amount amount of tokens to release
  */
  function releaseLockedTokens(
    address _of,
    bytes32 _reason,
    uint256 _amount
  ) public override onlyInternal {
    _releaseLockedTokens(_of, _reason, _amount);
  }

  /**
  * @dev Adds an address to whitelist maintained in the contract
  * @param _member address to add to whitelist
  */
  function addToWhitelist(address _member) public virtual override onlyInternal {
    token.addToWhiteList(_member);
  }

  /**
  * @dev Removes an address from the whitelist in the token
  * @param _member address to remove
  */
  function removeFromWhitelist(address _member) public override onlyInternal {
    token.removeFromWhiteList(_member);
  }

  /**
  * @dev Mints new token for an address
  * @param _member address to reward the minted tokens
  * @param _amount number of tokens to mint
  */
  function mint(address _member, uint _amount) public override onlyInternal {
    token.mint(_member, _amount);
  }

  /**
   * @dev Lock the user's tokens
   * @param _of user's address.
   */
  function lockForMemberVote(address _of, uint _days) public override onlyInternal {
    token.lockForMemberVote(_of, _days);
  }

  /**
  * @dev Unlocks the withdrawable tokens against CLA of a specified address
  * @param _of Address of user, claiming back withdrawable tokens against CLA
  */
  function withdrawClaimAssessmentTokens(address _of) external override checkPause {
    uint256 withdrawableTokens = _tokensUnlockable(_of, "CLA");
    if (withdrawableTokens > 0) {
      locked[_of]["CLA"].claimed = true;
      emit Unlocked(_of, "CLA", withdrawableTokens);
      token.transfer(_of, withdrawableTokens);
    }
  }

  /**
   * @dev Updates Uint Parameters of a code
   * @param code whose details we want to update
   * @param value value to set
   */
  function updateUintParameters(bytes8 code, uint value) external view onlyGovernance {
    // silence compiler warnings
    code;
    value;
    revert("TokenController: invalid param code");
  }

  function getLockReasons(address _of) external override view returns (bytes32[] memory reasons) {
    return lockReason[_of];
  }

  /**
  * @dev Gets the validity of locked tokens of a specified address
  * @param _of The address to query the validity
  * @param reason reason for which tokens were locked
  */
  function getLockedTokensValidity(
    address _of,
    bytes32 reason
  ) public override view returns (uint256 validity) {
    validity = locked[_of][reason].validity;
  }

  /**
  * @dev Gets the unlockable tokens of a specified address
  * @param _of The address to query the the unlockable token count of
  */
  function getUnlockableTokens(
    address _of
  ) public override view returns (uint256 unlockableTokens) {
    for (uint256 i = 0; i < lockReason[_of].length; i++) {
      unlockableTokens = unlockableTokens + _tokensUnlockable(_of, lockReason[_of][i]);
    }
  }

  /**
  * @dev Returns tokens locked for a specified address for a
  *    specified reason
  *
  * @param _of The address whose tokens are locked
  * @param _reason The reason to query the lock tokens for
  */
  function tokensLocked(
    address _of,
    bytes32 _reason
  ) public override view returns (uint256 amount) {
    return _tokensLocked(_of, _reason);
  }

  /**
  * @dev Returns tokens locked and validity for a specified address and reason
  * @param _of The address whose tokens are locked
  * @param _reason The reason to query the lock tokens for
  */
  function tokensLockedWithValidity(
    address _of,
    bytes32 _reason
  ) public override view returns (uint256 amount, uint256 validity) {

    bool claimed = locked[_of][_reason].claimed;
    amount = locked[_of][_reason].amount;
    validity = locked[_of][_reason].validity;

    if (claimed) {
      amount = 0;
    }
  }

  /**
  * @dev Returns unlockable tokens for a specified address for a specified reason
  * @param _of The address to query the the unlockable token count of
  * @param _reason The reason to query the unlockable tokens for
  */
  function tokensUnlockable(
    address _of,
    bytes32 _reason
  ) public override view returns (uint256 amount) {
    return _tokensUnlockable(_of, _reason);
  }

  function totalSupply() public override view returns (uint256) {
    return token.totalSupply();
  }

  /**
  * @dev Returns tokens locked for a specified address for a
  *    specified reason at a specific time
  *
  * @param _of The address whose tokens are locked
  * @param _reason The reason to query the lock tokens for
  * @param _time The timestamp to query the lock tokens for
  */
  function tokensLockedAtTime(
    address _of,
    bytes32 _reason,
    uint256 _time
  ) public override view returns (uint256 amount) {
    return _tokensLockedAtTime(_of, _reason, _time);
  }

  /**
  * @dev Returns the total amount of tokens held by an address:
  *   transferable + locked + staked for pooled staking - pending burns.
  *   Used by Claims and Governance in member voting to calculate the user's vote weight.
  *
  * @param _of The address to query the total balance of
  * @param _of The address to query the total balance of
  */
  function totalBalanceOf(address _of) public override view returns (uint256 amount) {

    amount = token.balanceOf(_of);

    for (uint256 i = 0; i < lockReason[_of].length; i++) {
      amount = amount + _tokensLocked(_of, lockReason[_of][i]);
    }

    uint stakerReward = pooledStaking.stakerReward(_of);
    uint stakerDeposit = pooledStaking.stakerDeposit(_of);

    (
      uint assessmentStake,
      /*uint104 rewardsWithdrawableFromIndex*/,
      /*uint16 fraudCount*/
    ) = assessment.stakeOf(_of);

    amount += stakerDeposit + stakerReward + assessmentStake;
  }

  /// Withdraws governance rewards
  /// @dev This function requires a batchSize that fits in one block. It cannot be 0.
  function withdrawGovernanceRewards(uint batchSize) public isMemberAndcheckPause {
    uint governanceRewards = governance.claimReward(msg.sender, batchSize);
    require(governanceRewards > 0, "TokenController: No withdrawable governance rewards");
    token.transfer(msg.sender, governanceRewards);
  }

  /// Function used to claim all pending rewards in one tx. It can be used to selectively withdraw
  /// rewards.
  ///
  /// @param batchSize  The maximum number of iterations to avoid unbounded loops
  /// @param batchSize  The maximum number of iterations to avoid unbounded loops
  function withdrawPendingRewards(
    address forUser,
    bool fromGovernance,
    bool fromAssessment,
    uint batchSize
  ) external isMemberAndcheckPause {
    if (fromAssessment) {
      assessment.withdrawRewards(forUser, batchSize.toUint104());
    }
    if (fromGovernance) {
      uint governanceRewards = governance.claimReward(forUser, batchSize);
      require(governanceRewards > 0, "TokenController: No withdrawable governance rewards");
      require(token.transfer(forUser, governanceRewards), "TokenController: Governance rewards transfer failed");
    }
  }


  /**
  * @dev Returns the total amount of locked and staked tokens.
  *      Used by MemberRoles to check eligibility for withdraw / switch membership.
  *      Includes tokens locked for claim assessment, tokens staked for risk assessment, and locked cover notes
  *      Does not take into account pending burns.
  * @param _of member whose locked tokens are to be calculate
  */
  function totalLockedBalance(address _of) public override view returns (uint256 amount) {

    for (uint256 i = 0; i < lockReason[_of].length; i++) {
      amount = amount + _tokensLocked(_of, lockReason[_of][i]);
    }

  }

  /**
  * @dev Locks a specified amount of tokens against an address,
  *    for a specified reason and time
  * @param _of address whose tokens are to be locked
  * @param _reason The reason to lock tokens
  * @param _amount Number of tokens to be locked
  * @param _time Lock time in seconds
  */
  function _lock(address _of, bytes32 _reason, uint256 _amount, uint256 _time) internal {
    require(_tokensLocked(_of, _reason) == 0, "TokenController: An amount of tokens is already locked");
    require(_amount != 0, "TokenController: Amount shouldn't be zero");

    if (locked[_of][_reason].amount == 0) {
      lockReason[_of].push(_reason);
    }

    token.operatorTransfer(_of, _amount);

    uint256 validUntil = block.timestamp + _time;
    locked[_of][_reason] = LockToken(_amount, validUntil, false);
    emit Locked(_of, _reason, _amount, validUntil);
  }

  /**
  * @dev Returns tokens locked for a specified address for a
  *    specified reason
  *
  * @param _of The address whose tokens are locked
  * @param _reason The reason to query the lock tokens for
  */
  function _tokensLocked(address _of, bytes32 _reason)
  internal
  view
  returns (uint256 amount)
  {
    if (!locked[_of][_reason].claimed) {
      amount = locked[_of][_reason].amount;
    }
  }

  /**
  * @dev Returns tokens locked for a specified address for a
  *    specified reason at a specific time
  *
  * @param _of The address whose tokens are locked
  * @param _reason The reason to query the lock tokens for
  * @param _time The timestamp to query the lock tokens for
  */
  function _tokensLockedAtTime(address _of, bytes32 _reason, uint256 _time)
  internal
  view
  returns (uint256 amount)
  {
    if (locked[_of][_reason].validity > _time) {
      amount = locked[_of][_reason].amount;
    }
  }

  /**
  * @dev Extends lock for a specified reason and time
  * @param _of The address whose tokens are locked
  * @param _reason The reason to lock tokens
  * @param _time Lock extension time in seconds
  */
  function _extendLock(address _of, bytes32 _reason, uint256 _time) internal {
    require(_tokensLocked(_of, _reason) > 0, "TokenController: No tokens locked");
    emit Unlocked(_of, _reason, locked[_of][_reason].amount);
    locked[_of][_reason].validity = locked[_of][_reason].validity + _time;
    emit Locked(_of, _reason, locked[_of][_reason].amount, locked[_of][_reason].validity);
  }

  /**
  * @dev reduce lock duration for a specified reason and time
  * @param _of The address whose tokens are locked
  * @param _reason The reason to lock tokens
  * @param _time Lock reduction time in seconds
  */
  function _reduceLock(address _of, bytes32 _reason, uint256 _time) internal {
    require(_tokensLocked(_of, _reason) > 0, "TokenController: No tokens locked");
    emit Unlocked(_of, _reason, locked[_of][_reason].amount);
    locked[_of][_reason].validity = locked[_of][_reason].validity - _time;
    emit Locked(_of, _reason, locked[_of][_reason].amount, locked[_of][_reason].validity);
  }

  /**
  * @dev Returns unlockable tokens for a specified address for a specified reason
  * @param _of The address to query the the unlockable token count of
  * @param _reason The reason to query the unlockable tokens for
  */
  function _tokensUnlockable(address _of, bytes32 _reason) internal view returns (uint256 amount)
  {
    if (locked[_of][_reason].validity <= block.timestamp && !locked[_of][_reason].claimed) {
      amount = locked[_of][_reason].amount;
    }
  }

  /**
  * @dev Burns locked tokens of a user
  * @param _of address whose tokens are to be burned
  * @param _reason lock reason for which tokens are to be burned
  * @param _amount amount of tokens to burn
  */
  function _burnLockedTokens(address _of, bytes32 _reason, uint256 _amount) internal {
    uint256 amount = _tokensLocked(_of, _reason);
    require(amount >= _amount, "TokenController: Amount exceedes locked tokens amount");

    if (amount == _amount) {
      locked[_of][_reason].claimed = true;
    }

    locked[_of][_reason].amount = locked[_of][_reason].amount - _amount;

    // lock reason removal is skipped here: needs to be done from offchain

    token.burn(_amount);
    emit Burned(_of, _reason, _amount);
  }

  /**
  * @dev Released locked tokens of an address locked for a specific reason
  * @param _of address whose tokens are to be released from lock
  * @param _reason reason of the lock
  * @param _amount amount of tokens to release
  */
  function _releaseLockedTokens(address _of, bytes32 _reason, uint256 _amount) internal
  {
    uint256 amount = _tokensLocked(_of, _reason);
    require(amount >= _amount, "TokenController: Amount exceedes locked tokens amount");

    if (amount == _amount) {
      locked[_of][_reason].claimed = true;
    }

    locked[_of][_reason].amount = locked[_of][_reason].amount - _amount;

    // lock reason removal is skipped here: needs to be done from offchain

    token.transfer(_of, _amount);
    emit Unlocked(_of, _reason, _amount);
  }

  // Can be removed once all cover notes are withdrawn
  function getWithdrawableCoverNotes(
    address coverOwner
  ) public view returns (
    uint[] memory coverIds,
    bytes32[] memory lockReasons,
    uint withdrawableAmount
  ) {

    uint[] memory allCoverIds = quotationData.getAllCoversOfUser(coverOwner);
    uint[] memory idsQueue = new uint[](allCoverIds.length);
    bytes32[] memory lockReasonsQueue = new bytes32[](allCoverIds.length);
    uint idsQueueLength = 0;

    for (uint i = 0; i < allCoverIds.length; i++) {
      uint coverId = allCoverIds[i];
      bytes32 lockReason = keccak256(abi.encodePacked("CN", coverOwner, coverId));
      uint coverNoteAmount = _tokensLocked(coverOwner, lockReason);

      if (coverNoteAmount > 0) {
        idsQueue[idsQueueLength] = coverId;
        lockReasonsQueue[idsQueueLength] = lockReason;
        withdrawableAmount += coverNoteAmount;
        idsQueueLength++;
      }
    }

    coverIds = new uint[](idsQueueLength);
    lockReasons = new bytes32[](idsQueueLength);

    for (uint i = 0; i < idsQueueLength; i++) {
      coverIds[i] = idsQueue[i];
      lockReasons[i] = lockReasonsQueue[i];
    }
  }

  // Can be removed once all cover notes are withdrawn
  function withdrawCoverNote(
    address user,
    uint[] calldata coverIds,
    uint[] calldata indexes
  ) external override {

    uint reasonCount = lockReason[user].length;
    require(reasonCount > 0, "TokenController: No locked cover notes found");
    uint lastReasonIndex = reasonCount - 1;
    uint totalAmount = 0;

    // The iteration is done from the last to first to prevent reason indexes from
    // changing due to the way we delete the items (copy last to current and pop last).
    // The provided indexes array must be ordered, otherwise reason index checks will fail.

    for (uint i = coverIds.length; i > 0; i--) {

      // note: cover owner is implicitly checked using the reason hash
      bytes32 _reason = keccak256(abi.encodePacked("CN", user, coverIds[i - 1]));
      uint _reasonIndex = indexes[i - 1];
      require(lockReason[user][_reasonIndex] == _reason, "TokenController: Bad reason index");

      uint amount = locked[user][_reason].amount;
      totalAmount = totalAmount + amount;
      delete locked[user][_reason];

      if (lastReasonIndex != _reasonIndex) {
        lockReason[user][_reasonIndex] = lockReason[user][lastReasonIndex];
      }

      lockReason[user].pop();
      emit Unlocked(user, _reason, amount);

      if (lastReasonIndex > 0) {
        lastReasonIndex = lastReasonIndex - 1;
      }
    }

    token.transfer(user, totalAmount);
  }

  function removeEmptyReason(address _of, bytes32 _reason, uint _index) external {
    _removeEmptyReason(_of, _reason, _index);
  }

  function removeMultipleEmptyReasons(
    address[] calldata _members,
    bytes32[] calldata _reasons,
    uint[] calldata _indexes
  ) external {

    require(_members.length == _reasons.length, "TokenController: members and reasons array lengths differ");
    require(_reasons.length == _indexes.length, "TokenController: reasons and indexes array lengths differ");

    for (uint i = _members.length; i > 0; i--) {
      uint idx = i - 1;
      _removeEmptyReason(_members[idx], _reasons[idx], _indexes[idx]);
    }
  }

  function _removeEmptyReason(address _of, bytes32 _reason, uint _index) internal {

    require(lockReason[_of].length > 0, "TokenController: lockReason is empty");
    uint lastReasonIndex = lockReason[_of].length- 1;

    require(lockReason[_of][_index] == _reason, "TokenController: bad reason index");
    require(locked[_of][_reason].amount == 0, "TokenController: reason amount is not zero");

    if (lastReasonIndex != _index) {
      lockReason[_of][_index] = lockReason[_of][lastReasonIndex];
    }

    lockReason[_of].pop();
  }

  function initialize() external {
    token.addToWhiteList(address(this));
    token.removeFromWhiteList(claimsReward);
    migrate();
  }

  function migrate() internal {
    // [todo] Remove CLA locks for all assessors
  }

  event Locked(address indexed _of, bytes32 indexed _reason, uint256 _amount, uint256 _validity);

  event Unlocked(address indexed _of, bytes32 indexed _reason, uint256 _amount);

  event Burned(address indexed member, bytes32 lockedUnder, uint256 amount);

}

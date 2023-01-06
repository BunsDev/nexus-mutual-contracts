// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.5.0;

contract MCRMockCover {

  mapping(uint => uint) public sumAssuredByAsset;


  function totalActiveCoverInAsset(uint coverAsset) external view returns (uint) {
    return sumAssuredByAsset[coverAsset];
  }

  function setTotalActiveCoverInAsset(uint asset, uint amount) public {
    sumAssuredByAsset[asset] = amount;
  }

  function activeCoverAmountCommitted() public pure returns (bool) {
    return true;
  }
}

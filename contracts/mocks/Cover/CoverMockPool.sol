// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.16;

import "../../interfaces/IPool.sol";

contract CoverMockPool {

  mapping (uint => uint) prices;
  Asset[] public assets;

  uint32 public deprecatedCoverAssetsBitmap;

  address constant public ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  constructor() {
    // First asset is ETH
    assets.push(Asset(ETH, true, false));
  }

  function getTokenPrice(uint assetId) public view returns (uint) {
    return prices[assetId];
  }

  function setTokenPrice(uint assetId, uint price) public {
    prices[assetId] = price;
  }

  function setAssets(Asset[] memory _assets) public {
    for (uint i = 0; i < _assets.length; i++) {
      assets.push(_assets[i]);
    }
  }

  function setDeprecatedCoverAssetsBitmap(uint32 bitmap) external {
    deprecatedCoverAssetsBitmap = bitmap;
  }

  fallback() external payable {}

  receive() external payable {}

}

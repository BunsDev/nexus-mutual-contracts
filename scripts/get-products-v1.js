require('dotenv').config();
const fs = require('fs');

const outpputDir = './deploy/';
const getProductsContract = x => `// SPDX-License-Identifier: GPL-3.0-only

pragma solidity >=0.5.0;

import "../../interfaces/IProductsV1.sol";

contract ProductsV1 is IProductsV1 {
  function getNewProductId(address legacyProductId) external pure override returns (uint) {
    ${x.join('')}
    revert("Invalid product!");
  }
}
`;

const main = async () => {
  const products = JSON.parse(fs.readFileSync('./scripts/v2-migration-input/contracts.json'));
  const deprecatedV1Products = Object.keys(products)
    .filter(k => products[k].deprecated)
    .map((k, i) => ({ ...products[k], productId: i, legacyProductId: k }));
  const migratable = Object.keys(products)
    .filter(k => !products[k].deprecated)
    .map((k, i) => ({ ...products[k], productId: i, legacyProductId: k }));
  const ProductsV1 = getProductsContract(
    migratable.map(
      x => `
    // Product: ${x.name}
    // Type: ${x.type}
    if (legacyProductId == ${x.legacyProductId}) {
      return ${x.productId};
    }
    `,
    ),
  );
  fs.writeFileSync(
    outpputDir + 'migratableProducts.json',
    JSON.stringify(
      migratable.map(({ name, type, supportedChains, logo, underlyingToken, coveredToken }) => ({
        name,
        type,
        supportedChains,
        logo,
        underlyingToken,
        coveredToken,
      })),
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    outpputDir + 'v1ProductIds.json',
    JSON.stringify(
      migratable.map(x => x.legacyProductId),
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    outpputDir + 'deprecatedV1Products.json',
    JSON.stringify(
      deprecatedV1Products
        .map(({ name, type, supportedChains, logo, legacyProductId }) => ({
          name,
          type,
          supportedChains,
          logo,
          legacyProductId,
        }))
        .reduce((acc, curr) => {
          acc[curr.legacyProductId] = {
            name: curr.name,
            type: curr.type,
            supportedChains: curr.supportedChains,
            logo: curr.logo,
          };
          return acc;
        }, {}),
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync('./contracts/modules/cover/ProductsV1.sol', ProductsV1, 'utf8');
};

if (!module.parent) {
  main().catch(e => {
    console.log('Unhandled error encountered: ', e.stack);
    process.exit(1);
  });
}

module.exports = { main };

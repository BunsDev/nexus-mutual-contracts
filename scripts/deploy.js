const { artifacts, config, network, run, web3 } = require('hardhat');
const {
  ether,
  constants: { ZERO_ADDRESS },
} = require('@openzeppelin/test-helpers');
const fs = require('fs');

const Verifier = require('../lib/verifier');
const { getEnv, hex } = require('../lib/helpers');
const proposalCategories = require('../lib/proposal-categories');

const { toBN } = web3.utils;

// external
const ERC20MintableDetailed = artifacts.require('ERC20MintableDetailed');
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy');

// nexusmutual
const NXMToken = artifacts.require('NXMToken');
const LegacyClaimsReward = artifacts.require('LegacyClaimsReward');
const IndividualClaims = artifacts.require('IndividualClaims');
const YieldTokenIncidents = artifacts.require('YieldTokenIncidents');
const Assessment = artifacts.require('Assessment');
const Pool = artifacts.require('Pool');
const QuotationData = artifacts.require('TestnetQuotationData');
const PriceFeedOracle = artifacts.require('PriceFeedOracle');
const CowSwapOperator = artifacts.require('CowSwapOperator');
const CSMockSettlement = artifacts.require('CSMockSettlement');
const CSMockVaultRelayer = artifacts.require('CSMockVaultRelayer');
const DisposableMCR = artifacts.require('DisposableMCR');
const Cover = artifacts.require('Cover');
const CoverViewer = artifacts.require('CoverViewer');
const CoverMigrator = artifacts.require('CoverMigrator');

// temporary contracts used for initialization
const DisposableNXMaster = artifacts.require('DisposableNXMaster');
const DisposableMemberRoles = artifacts.require('DisposableMemberRoles');
const DisposableTokenController = artifacts.require('DisposableTokenController');
const DisposableProposalCategory = artifacts.require('DisposableProposalCategory');
const DisposableGovernance = artifacts.require('DisposableGovernance');
const DisposablePooledStaking = artifacts.require('DisposablePooledStaking');
const DisposableGateway = artifacts.require('DisposableGateway');
const DisposableCover = artifacts.require('DisposableCover');
const CoverNFT = artifacts.require('CoverNFT');
const CoverMockStakingPool = artifacts.require('CoverMockStakingPool');
const CoverUtilsLib = artifacts.require('CoverUtilsLib');

// target contracts
const TestnetNXMaster = artifacts.require('TestnetNXMaster');
const MemberRoles = artifacts.require('MemberRoles');
const TokenController = artifacts.require('TokenController');
const ProposalCategory = artifacts.require('ProposalCategory');
const Governance = artifacts.require('Governance');
const PooledStaking = artifacts.require('LegacyPooledStaking');
const ProductsV1 = artifacts.require('ProductsV1');
const Gateway = artifacts.require('LegacyGateway');

// external contracts
const ChainlinkAggregatorMock = artifacts.require('ChainlinkAggregatorMock');

const INITIAL_SUPPLY = ether('1500000');
const etherscanApiKey = getEnv('ETHERSCAN_API_KEY');

// source: https://docs.chain.link/docs/price-feeds-migration-august-2020
const CHAINLINK_DAI_ETH_AGGREGATORS = {
  hardhat: '0x0000000000000000000000000000000000000000',
  mainnet: '0x773616E4d11A78F511299002da57A0a94577F1f4',
  rinkeby: '0x2bA49Aaa16E6afD2a993473cfB70Fa8559B523cF',
  kovan: '0x22B58f1EbEDfCA50feF632bD73368b2FdA96D541',
  tenderly: '0x22B58f1EbEDfCA50feF632bD73368b2FdA96D541',
  // used when running hh node to fork a network, change me if needed
  localhost: '0x22B58f1EbEDfCA50feF632bD73368b2FdA96D541',
};

const CHAINLINK_STETH_ETH_AGGREGATORS = {
  hardhat: '0x0000000000000000000000000000000000000000',
  mainnet: '0x716BB759A5f6faCdfF91F0AfB613133d510e1573',
  rinkeby: '0x525cD3ca0601Ab455af06A4c179C26Ad7da34bA9', // mock, returns price = 1 eth
  kovan: '0x302257dB355951Ee3caa42E9355Ae27C02Ae9422', // mock, returns price = 1 eth
  tenderly: '0x302257dB355951Ee3caa42E9355Ae27C02Ae9422',
  localhost: '0x302257dB355951Ee3caa42E9355Ae27C02Ae9422',
};

async function main () {
  // make sure the contracts are compiled and we're not deploying an outdated artifact
  await run('compile');

  console.log(`Using network: ${network.name}`);
  console.log('Network config:', config.networks[network.name]);

  const [owner] = await web3.eth.getAccounts();
  const verifier = new Verifier(web3, etherscanApiKey, network.name);

  const deployProxy = async (contract, deployParams = []) => {
    const implementation = await contract.new(...deployParams);
    const proxy = await OwnedUpgradeabilityProxy.new(implementation.address);
    const instance = await contract.at(proxy.address);
    return { instance, implementation, proxy };
  };

  const upgradeProxy = async (proxyAddress, contract, deployParams = []) => {
    console.log(`Upgrading proxy ${contract.contractName}`);
    const implementation = await contract.new(...deployParams);
    const proxy = await OwnedUpgradeabilityProxy.at(proxyAddress);
    await proxy.upgradeTo(implementation.address);
    try {
      const c = await contract.at(proxyAddress);
      await c.changeDependentContractAddress();
    } catch (e) {
      console.log(`[WARNING]: ${contract.contractName} has no changeDependentContractAddress method`);
    }
    return { implementation };
  };

  const transferProxyOwnership = async (proxyAddress, newOwner) => {
    const proxy = await OwnedUpgradeabilityProxy.at(proxyAddress);
    await proxy.transferProxyOwnership(newOwner);
  };

  // deploy external contracts
  console.log('Deploying DAI');
  const dai = await ERC20MintableDetailed.new('DAI Mock', 'DAI', 18);

  verifier.add(dai, {
    constructorArgs: ['DAI Mock', 'DAI', 18],
    fullPath: 'contracts/mocks/Tokens/ERC20MintableDetailed.sol:ERC20MintableDetailed',
  });

  console.log('Deploying stETH');
  const stETH = await ERC20MintableDetailed.new('stETH Mock', 'stETH', 18);
  verifier.add(stETH, {
    constructorArgs: ['stETH Mock', 'stETH', 18],
    fullPath: 'contracts/mocks/Tokens/ERC20MintableDetailed.sol:ERC20MintableDetailed',
  });

  console.log('Deploying token contracts');
  const tk = await NXMToken.new(owner, INITIAL_SUPPLY);

  verifier.add(tk, { constructorArgs: [owner, INITIAL_SUPPLY.toString()] });

  const { instance: master, implementation: masterImpl } = await deployProxy(DisposableNXMaster);
  const { instance: mr, implementation: mrImpl } = await deployProxy(DisposableMemberRoles);

  console.log('Deploying quotation contracts');
  const qd = await QuotationData.new(owner, owner);

  console.log('Deploying legacy claims reward');
  const lcr = await LegacyClaimsReward.new(master.address, dai.address);
  verifier.add(lcr, { constructorArgs: [master.address, dai.address] });

  console.log('Deploying disposable contracts');
  const { instance: cover, implementation: coverImpl } = await deployProxy(DisposableCover, []);
  const { instance: tc, implementation: tcImpl } = await deployProxy(DisposableTokenController, [
    qd.address,
    lcr.address,
  ]);
  const stakingPoolParameters = [tk.address, cover.address, tc.address, mr.address];
  const stakingPool = await CoverMockStakingPool.new(...stakingPoolParameters);
  const coverMigrator = await CoverMigrator.new();
  const coverNFT = await CoverNFT.new('Nexus Mutual Cover', 'NMC', cover.address);
  const { instance: ps, implementation: psImpl } = await deployProxy(DisposablePooledStaking);
  const { instance: pc, implementation: pcImpl } = await deployProxy(DisposableProposalCategory);
  const { instance: gv, implementation: gvImpl } = await deployProxy(DisposableGovernance, [{ gas: 12e6 }]);
  const { instance: gateway, implementation: gatewayImpl } = await deployProxy(DisposableGateway);
  const {
    instance: yieldTokenIncidents,
    implementation: yieldTokenIncidentsImpl,
  } = await deployProxy(YieldTokenIncidents, [tk.address, coverNFT.address]);
  const { instance: individualClaims, implementation: individualClaimsImpl } = await deployProxy(IndividualClaims, [
    tk.address,
    coverNFT.address,
  ]);
  const { instance: assessment, implementation: assessmentImpl } = await deployProxy(Assessment, [tk.address]);

  const proxiesAndImplementations = [
    { proxy: master, implementation: masterImpl, contract: 'DisposableNXMaster' },
    { proxy: mr, implementation: mrImpl, contract: 'DisposableMemberRoles' },
    { proxy: tc, implementation: tcImpl, contract: 'DisposableTokenController' },
    { proxy: ps, implementation: psImpl, contract: 'DisposablePooledStaking' },
    { proxy: pc, implementation: pcImpl, contract: 'DisposableProposalCategory' },
    { proxy: gv, implementation: gvImpl, contract: 'DisposableGovernance' },
    { proxy: gateway, implementation: gatewayImpl, contract: 'DisposableGateway' },
    { proxy: yieldTokenIncidents, implementation: yieldTokenIncidentsImpl, contract: 'YieldTokenIncidents' },
    { proxy: individualClaims, implementation: individualClaimsImpl, contract: 'IndividualClaims' },
    { proxy: cover, implementation: coverImpl, contract: 'Cover' },
    { proxy: assessment, implementation: assessmentImpl, contract: 'Assessment' },
  ];

  for (const addresses of proxiesAndImplementations) {
    const { contract, proxy, implementation } = addresses;
    verifier.add(await OwnedUpgradeabilityProxy.at(proxy.address), {
      alias: contract,
      constructorArgs: [implementation.address],
    });
    verifier.add(implementation);
  }

  const CLAIM_METHOD = {
    INDIVIDUAL_CLAIMS: 0,
    YIELD_TOKEN_INCIDENTS: 1,
  };

  await cover.addProductTypes(
    [
      // Protocol Cover
      {
        descriptionIpfsHash: 'protocolCoverIPFSHash',
        claimMethod: CLAIM_METHOD.INDIVIDUAL_CLAIMS,
        gracePeriodInDays: 30,
      },
      // Custody Cover
      {
        descriptionIpfsHash: 'custodyCoverIPFSHash',
        claimMethod: CLAIM_METHOD.INDIVIDUAL_CLAIMS,
        gracePeriodInDays: 90,
      },
      // Yield Token Cover
      {
        descriptionIpfsHash: 'yieldTokenCoverIPFSHash',
        claimMethod: CLAIM_METHOD.YIELD_TOKEN_INCIDENTS,
        gracePeriodInDays: 14,
      },
    ],
    ['', '', ''],
  );

  const products = JSON.parse(fs.readFileSync('./deploy/migratableProducts.json'));
  const addProductsParams = products.map(x => {
    const underlyingToken = ['ETH', 'DAI'].indexOf(x.underlyingToken);
    return {
      productType: { protocol: 0, custodian: 1, token: 2 }[x.type],
      productAddress: x.coveredToken || '0x0000000000000000000000000000000000000000',
      coverAssets:
        x.legacyProductId === '0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B'
          ? 0b01 // only ETH for MakerDAO
          : underlyingToken === -1
            ? 0 // when no underlyingToken is present use the global fallback
            : 1 << underlyingToken, // 0b01 for ETH and 0b10 for DAI
      initialPriceRatio: 100,
      capacityReductionRatio: 0,
    };
  });

  // [todo] Add ipfs hashes
  await cover.addProducts(addProductsParams, Array(products.length).fill('')); // non-proxy contracts and libraries
  console.log('Deploying CowSwapOperator, PriceFeedOracle');
  const cowVaultRelayer = await CSMockVaultRelayer.new();
  const cowSettlement = await CSMockSettlement.new(cowVaultRelayer.address);
  const swapOperator = await CowSwapOperator.new(
    cowSettlement.address,
    owner,
    master.address,
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  );

  verifier.add(swapOperator, { constructorArgs: [master.address, owner.address, owner, stETH.address] });

  let priceFeedOracle;
  if (['hardhat', 'localhost'].includes(network.name)) {
    const chainlinkDaiMock = await ChainlinkAggregatorMock.new();
    await chainlinkDaiMock.setLatestAnswer('357884806717390');
    const chainlinkStEthMock = await ChainlinkAggregatorMock.new();
    await chainlinkStEthMock.setLatestAnswer('1000000000000000000');
    verifier.add(chainlinkDaiMock);
    verifier.add(chainlinkStEthMock);
    priceFeedOracle = await PriceFeedOracle.new(
      [dai.address, stETH.address],
      [chainlinkDaiMock.address, chainlinkStEthMock.address],
      [18, 18],
    );
  } else {
    priceFeedOracle = await PriceFeedOracle.new(
      [dai.address, stETH.address],
      [CHAINLINK_DAI_ETH_AGGREGATORS[network.name], CHAINLINK_STETH_ETH_AGGREGATORS[network.name]],
      [18, 18],
    );
  }

  verifier.add(priceFeedOracle, {
    constructorArgs: [CHAINLINK_DAI_ETH_AGGREGATORS[network.name], dai.address, stETH.address],
  });

  verifier.add(qd, { constructorArgs: [owner] });

  console.log('Deploying capital contracts');
  const mc = await DisposableMCR.new(ZERO_ADDRESS);

  const mcrEth = ether('50000');
  const mcrFloor = mcrEth.sub(ether('10000'));

  const latestBlock = await web3.eth.getBlock('latest');
  const lastUpdateTime = latestBlock.timestamp - 60;
  const mcrFloorIncrementThreshold = 13000;
  const maxMCRFloorIncrement = 100;
  const maxMCRIncrement = 500;
  const gearingFactor = 48000;
  const minUpdateTime = 3600;

  await mc.initialize(
    mcrEth,
    mcrFloor,
    mcrEth, // desiredMCR
    lastUpdateTime,
    mcrFloorIncrementThreshold,
    maxMCRFloorIncrement,
    maxMCRIncrement,
    gearingFactor,
    minUpdateTime,
  );

  const poolParameters = [master.address, priceFeedOracle.address, swapOperator.address, dai.address, stETH.address];

  const p1 = await Pool.new(...poolParameters);

  verifier.add(mc, { constructorArgs: [ZERO_ADDRESS] });
  verifier.add(p1, { constructorArgs: poolParameters });
  verifier.add(stakingPool, { constructorArgs: stakingPoolParameters });
  verifier.add(coverMigrator, { constructorArgs: [] });

  const upgradableContractCodes = ['MC', 'P1', 'SP', 'CL'];
  const upgradableContractAddresses = [mc, p1, stakingPool, coverMigrator].map(x => x.address);

  const proxyContractCodes = ['GV', 'MR', 'PC', 'PS', 'TC', 'GW', 'CO', 'YT', 'IC', 'AS'];
  const proxyContractAddresses = [
    { address: owner }, // as governance
    mr,
    pc,
    ps,
    tc,
    gateway,
    cover,
    yieldTokenIncidents,
    individualClaims,
    assessment,
  ].map(x => x.address);

  const addresses = [...upgradableContractAddresses, ...proxyContractAddresses];
  const codes = [...upgradableContractCodes, ...proxyContractCodes].map(hex);
  const types = [...upgradableContractCodes.fill(1), ...proxyContractCodes.fill(2)]; // 1 for upgradable 2 for proxy

  console.log('Deploying ProductsV1 contract');
  const productsV1 = await ProductsV1.new();

  console.log('Running initializations');
  await master.initialize(owner, tk.address, owner, codes, types, addresses);

  await tc.initialize(master.address, tk.address, ps.address, assessment.address);

  await mr.initialize(
    owner,
    master.address,
    tc.address,
    [owner], // initial members
    [ether('10000')], // initial tokens
    [owner], // advisory board members
  );

  await gv.initialize(
    toBN(600), // 10 minutes
    toBN(600), // 10 minutes
    toBN(5),
    toBN(40),
    toBN(75),
    toBN(300), // 5 minutes
  );

  await ps.initialize(
    tc.address,
    ether('2'), // min stake
    ether('2'), // min unstake
    10, // max exposure
    600, // unstake lock time
  );

  await yieldTokenIncidents.initialize();

  await gateway.initialize(master.address, dai.address);

  console.log('Adding proposal categories');

  await pc.initialize(mr.address);

  for (const category of proposalCategories) {
    await pc.addInitialCategory(...category);
  }

  console.log('Setting parameters');

  console.log('Setting QuotationData parameters');
  await qd.changeMasterAddress(master.address);

  await master.switchGovernanceAddress(gv.address);

  console.log('Upgrading to non-disposable contracts');
  const { implementation: newMasterImpl } = await upgradeProxy(master.address, TestnetNXMaster);
  const { implementation: newMrImpl } = await upgradeProxy(mr.address, MemberRoles);
  const { implementation: newTcImpl } = await upgradeProxy(tc.address, TokenController, [qd.address, lcr.address]);
  const { implementation: newPsImpl } = await upgradeProxy(ps.address, PooledStaking, [
    cover.address,
    productsV1.address,
  ]);
  const { implementation: newPcImpl } = await upgradeProxy(pc.address, ProposalCategory);
  const { implementation: newGvImpl } = await upgradeProxy(gv.address, Governance);

  console.log('Deploying and linking CoverUtilsLib in Cover contract');
  const coverUtilsLib = await CoverUtilsLib.new();
  await Cover.link(coverUtilsLib);

  const { implementation: newCoverImpl } = await upgradeProxy(cover.address, Cover, [
    qd.address,
    productsV1.address,
    coverNFT.address,
    stakingPool.address,
    cover.address,
  ]);
  const { implementation: newGatewayImpl } = await upgradeProxy(gateway.address, Gateway);

  verifier.add(newMasterImpl);
  verifier.add(newMrImpl);
  verifier.add(newTcImpl);
  verifier.add(newPsImpl);
  verifier.add(newPcImpl);
  verifier.add(newGvImpl);
  verifier.add(newGatewayImpl);
  verifier.add(newCoverImpl);
  verifier.add(productsV1);
  verifier.add(coverNFT);

  console.log('Transfering ownership of proxy contracts');
  await transferProxyOwnership(mr.address, master.address);
  await transferProxyOwnership(tc.address, master.address);
  await transferProxyOwnership(ps.address, master.address);
  await transferProxyOwnership(pc.address, master.address);
  await transferProxyOwnership(gv.address, master.address);
  await transferProxyOwnership(gateway.address, master.address);
  await transferProxyOwnership(cover.address, master.address);
  await transferProxyOwnership(master.address, gv.address);

  console.log('Deploying external contracts');

  console.log('Deploying CoverViewer');

  const coverViewer = await CoverViewer.new(master.address);
  verifier.add(coverViewer, { constructorArgs: [master.address] });

  const deployDataFile = `${__dirname}/../deploy/${network.name}-deploy-data.json`;
  verifier.dump(deployDataFile);

  console.log('Minting DAI to pool');
  await dai.mint(p1.address, ether('6500000'));

  console.log('Set governanceOwner to allow execution of onlyGovernance actions.');
  const testnetMaster = await TestnetNXMaster.at(master.address);
  await testnetMaster.initializeGovernanceOwner();

  if (!['hardhat', 'localhost'].includes(network.name)) {
    console.log('Performing verifications');
    await verifier.submit();
  }

  console.log('Done!');
  process.exit(0);
}

main().catch(error => {
  console.error('An unexpected error encountered:', error);
  process.exit(1);
});

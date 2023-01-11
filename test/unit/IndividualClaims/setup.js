const { ethers } = require('hardhat');
const { hex } = require('../../../lib/helpers');
const { getAccounts } = require('../../utils/accounts');
const { parseEther } = ethers.utils;

async function setup() {
  const NXM = await ethers.getContractFactory('NXMTokenMock');
  const nxm = await NXM.deploy();
  await nxm.deployed();

  const MemberRoles = await ethers.getContractFactory('MemberRolesMock');
  const memberRoles = await MemberRoles.deploy();
  await memberRoles.deployed();

  const CLMockTokenController = await ethers.getContractFactory('CLMockTokenController');
  const tokenController = await CLMockTokenController.deploy(nxm.address);
  await tokenController.deployed();

  nxm.setOperator(tokenController.address);

  const Master = await ethers.getContractFactory('MasterMock');
  const master = await Master.deploy();
  await master.deployed();

  const DAI = await ethers.getContractFactory('ERC20BlacklistableMock');
  const dai = await DAI.deploy();
  await dai.deployed();

  const CLMockPool = await ethers.getContractFactory('CLMockPool');
  const pool = await CLMockPool.deploy();
  await pool.deployed();
  await pool.addAsset(dai.address, 18);

  const Assessment = await ethers.getContractFactory('CLMockAssessment');
  const assessment = await Assessment.deploy();
  await assessment.deployed();

  const CoverNFT = await ethers.getContractFactory('CLMockCoverNFT');
  const coverNFT = await CoverNFT.deploy();
  await coverNFT.deployed();

  const IndividualClaims = await ethers.getContractFactory('IndividualClaims');
  const individualClaims = await IndividualClaims.deploy(nxm.address, coverNFT.address);
  await individualClaims.deployed();

  const Cover = await ethers.getContractFactory('CLMockCover');
  const cover = await Cover.deploy(coverNFT.address);
  await cover.deployed();

  const Distributor = await ethers.getContractFactory('CLMockDistributor');
  const distributor = await Distributor.deploy(individualClaims.address);
  await distributor.deployed();

  const masterInitTxs = await Promise.all([
    master.setLatestAddress(hex('TC'), tokenController.address),
    master.setLatestAddress(hex('MR'), memberRoles.address),
    master.setLatestAddress(hex('P1'), pool.address),
    master.setLatestAddress(hex('AS'), assessment.address),
    master.setLatestAddress(hex('CO'), cover.address),
    master.setLatestAddress(hex('IC'), individualClaims.address),
    master.setTokenAddress(nxm.address),
  ]);
  await Promise.all(masterInitTxs.map(x => x.wait()));
  await cover.addProductType('0', '30', '5000');
  await cover.addProductType('0', '90', '5000');
  await cover.addProductType('1', '30', '5000');

  await cover.addProduct(['0', '0x1111111111111111111111111111111111111111', '1', '0', '0']);
  await cover.addProduct(['1', '0x2222222222222222222222222222222222222222', '1', '0', '0']);
  await cover.addProduct(['2', '0x3333333333333333333333333333333333333333', '1', '0', '0']);

  await individualClaims.changeMasterAddress(master.address);
  await individualClaims.changeDependentContractAddress();
  await individualClaims.initialize();

  const accounts = await getAccounts();
  await master.enrollGovernance(accounts.governanceContracts[0].address);
  for (const member of accounts.members) {
    await memberRoles.setRole(member.address, 2);
    await nxm.mint(member.address, parseEther('10000'));
    await nxm.connect(member).approve(tokenController.address, parseEther('10000'));
  }

  accounts.defaultSender.sendTransaction({ to: pool.address, value: parseEther('200') });
  dai.mint(pool.address, parseEther('200'));

  const config = await individualClaims.config();

  this.config = config;
  this.accounts = accounts;
  this.contracts = {
    pool,
    nxm,
    dai,
    individualClaims,
    assessment,
    cover,
    distributor,
    coverNFT,
    master,
    memberRoles,
  };
}

module.exports = {
  setup,
};

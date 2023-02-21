const { ethers, config } = require('hardhat');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const VERSION_DATA_URL = 'https://api.nexusmutual.io/version-data/data.json';
const OUTPUT_FILE = path.join(
  config.paths.root,
  'scripts/v2-migration/output', // dir
  'cn-locked-amount.json', // filename
);

const getContractFactory = async providerOrSigner => {
  const data = await fetch(VERSION_DATA_URL).then(r => r.json());
  const abis = data.mainnet.abis
    .map(item => ({ ...item, abi: JSON.parse(item.contractAbi) }))
    .reduce((data, item) => ({ ...data, [item.code]: item }), {});

  return async code => {
    const { abi, address } = abis[code];
    return new ethers.Contract(address, abi, providerOrSigner);
  };
};

const ROLE_MEMBER = 2;

async function getMemberCN(i, mr, tc) {
  const { 0: member, 1: active } = await mr.memberAtIndex(ROLE_MEMBER, i);
  if (!active) {
    return { member, amount: '0' };
  }

  const { coverIds, lockReasons, withdrawableAmount } = await tc.getWithdrawableCoverNotes(member);
  return { member, coverIds, lockReasons, amount: withdrawableAmount.toString() };
}

const main = async (provider, useCache = true) => {
  // check the cache first
  if (useCache && fs.existsSync(OUTPUT_FILE)) {
    console.log('Using cached data for TC locked amount');
    return JSON.parse(fs.readFileSync(OUTPUT_FILE).toString());
  }
  const factory = await getContractFactory(provider);
  const tc = await factory('TC');
  const mr = await factory('MR');

  const memberCount = (await mr.membersLength(ROLE_MEMBER)).toNumber();
  const memberIds = [...Array(memberCount).keys()];
  const memberLockedCN = {};

  console.log('Fetching locked CN amounts for all members...');
  while (memberIds.length > 0) {
    const batch = memberIds.splice(0, 200);
    const lockedCN = await Promise.all(batch.map(i => getMemberCN(i, mr, tc)));
    for (const locked of lockedCN) {
      if (!lockedCN[locked.member] && locked.amount !== '0') {
        memberLockedCN[locked.member] = locked.amount;
      }
    }
    console.log(
      `Found ${
        Object.keys(memberLockedCN).length
      } members with locked NXM for CN; processed a batch of 200/${memberCount}`,
    );
  }

  console.log('Writing output to output/cn-locked-amount.json...');
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(memberLockedCN, null, 2), 'utf8');
  console.log('Done.');
};

if (require.main === module) {
  // use default provider and bypass cache when run via cli
  main(ethers.provider, false)
    .then(() => process.exit(0))
    .catch(e => {
      console.log('Unhandled error encountered: ', e.stack);
      process.exit(1);
    });
}

module.exports = main;

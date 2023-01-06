const assert = require('assert');
const readline = require('readline');
const { BN, toBN } = require('web3').utils;
const { BigNumber } = require('ethers');

const hex = string => '0x' + Buffer.from(string).toString('hex');
const toBytes8 = s => '0x' + Buffer.from(s).toString('hex').padEnd(16, '0');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const filterArgsKeys = args => {
  const params = {};
  for (const key of Object.keys(args)) {
    if (isNaN(key) && key !== '__length__') {
      const value = args[key];
      params[key] = BN.isBN(value) ? value.toString() : value;
    }
  }
  return params;
};

const to = promise =>
  new Promise(resolve => {
    promise.then(r => resolve([r, null])).catch(e => resolve([null, e]));
  });

function waitForInput(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    }),
  );
}

function bnEqual(actual, expected, message) {
  if (BigNumber.isBigNumber(actual)) {
    const fgYellow = '\x1b[33m';
    const reset = '\x1b[0m';
    console.warn(
      `${fgYellow}%s${reset}`,
      [
        'Warning',
        'Use Hardhat Chai Matchers instead of bnEqual',
        'https://hardhat.org/hardhat-chai-matchers/docs/overview#big-numbers',
      ].join(': '),
    );
  }

  const actualBN = toBN(actual);
  const expectedBN = toBN(expected);
  const error = message || `expected ${actualBN.toString()} to equal ${expectedBN.toString()}`;

  if (actualBN.eq(expectedBN)) {
    return;
  }

  throw new assert.AssertionError({
    message: error,
    actual: actualBN.toString(),
    expected: expectedBN.toString(),
    operator: 'bnEqual',
  });
}

function zeroPadRight(bytes, length) {
  return new Uint8Array(length).fill(0).map((x, i) => bytes[i] || x);
}

const daysToSeconds = days => days * 24 * 60 * 60;

module.exports = {
  bnEqual,
  filterArgsKeys,
  hex,
  toBytes8,
  sleep,
  to,
  waitForInput,
  zeroPadRight,
  daysToSeconds,
};

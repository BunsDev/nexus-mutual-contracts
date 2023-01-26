const { takeSnapshot, revertToSnapshot } = require('../utils').evm;
const setup = require('./setup');

describe('Cover unit tests', function () {
  before(setup);

  beforeEach(async function () {
    this.snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(this.snapshotId);
  });

  require('./constructor');
  require('./buyCover');
  require('./updateUintParameters');
  require('./editCover');
  require('./createStakingPool');
  require('./totalActiveCoverInAsset');
  require('./burnStake');
  require('./initialize');
  require('./setProducts');
  require('./setProductTypes');
});

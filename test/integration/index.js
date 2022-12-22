const { takeSnapshot, revertToSnapshot } = require('./utils').evm;
const setup = require('./setup');

describe('INTEGRATION TESTS', function () {
  before(setup);

  beforeEach(async function () {
    this.snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(this.snapshotId);
  });

  require('./IndividualClaims');
  require('./YieldTokenIncidents');
  require('./Cover');

  // TODO: reenable
  require('./Master');
  // require('./PooledStaking');
  require('./Pool');
  require('./MCR');
  require('./MemberRoles');
  // require('./Gateway');
  // require('./TokenController');
});

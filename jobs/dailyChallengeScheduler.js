const DailyChallenge = require('../models/DailyChallenge');

const SWEEP_INTERVAL_MS = 60 * 1000;

async function sweepOnce() {
  const now = new Date();

  await DailyChallenge.updateMany(
    { status: 'scheduled', startAt: { $lte: now } },
    { $set: { status: 'published', publishedAt: now, notifiedAt: now } }
  );

  await DailyChallenge.updateMany(
    { status: 'published', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  );
}

function startDailyChallengeScheduler() {
  sweepOnce().catch((err) => console.error('DailyChallenge scheduler error:', err));
  setInterval(() => {
    sweepOnce().catch((err) => console.error('DailyChallenge scheduler error:', err));
  }, SWEEP_INTERVAL_MS);
  console.log('Daily Challenge scheduler started (60s sweep)');
}

module.exports = { startDailyChallengeScheduler, sweepOnce };

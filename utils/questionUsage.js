const Question = require('../models/Question');
const ExamQuestion = require('../models/ExamQuestion');
const DailyChallenge = require('../models/DailyChallenge');

/**
 * Flags the questions in a list (Question Bank or Practice Questions) that were already used, so admins can avoid
 * picking the same one twice. Tests and Daily Challenges hold *copies* of questions, and each copy remembers where it
 * came from in `field` ('bankQuestionId' or 'practiceQuestionId').
 *  - usedInChallenge: the latest Daily Challenge that has it
 *  - usedInTest: the latest test it was copied into, and how many tests use it
 * Items are changed in place.
 */
const attachUsage = async (items, field = 'bankQuestionId') => {
  if (items.length === 0) return;
  const ids = items.map((item) => item._id);
  const [copies, testQuestions] = await Promise.all([
    Question.find({ [field]: { $in: ids } }).select(`_id ${field}`).lean(),
    ExamQuestion.find({ [field]: { $in: ids } }).select(`${field} testId testName createdAt`).sort({ createdAt: -1 }).lean()
  ]);

  const challengeUsage = new Map();
  if (copies.length > 0) {
    const sourceIdByCopy = new Map(copies.map((copy) => [String(copy._id), String(copy[field])]));
    const challenges = await DailyChallenge.find({ questionIds: { $in: copies.map((copy) => copy._id) } })
      .select('title startAt status questionIds')
      .sort({ startAt: -1 })
      .lean();
    for (const challenge of challenges) {
      for (const copyId of challenge.questionIds) {
        const sourceId = sourceIdByCopy.get(String(copyId));
        if (!sourceId) continue;
        const entry = challengeUsage.get(sourceId);
        if (entry) entry.count += 1;
        else challengeUsage.set(sourceId, { challengeId: challenge._id, title: challenge.title, startAt: challenge.startAt, status: challenge.status, count: 1 });
      }
    }
  }

  const testUsage = new Map();
  for (const testQuestion of testQuestions) {
    const sourceId = String(testQuestion[field]);
    const testKey = String(testQuestion.testId || testQuestion.testName);
    const entry = testUsage.get(sourceId);
    if (!entry) testUsage.set(sourceId, { testId: testQuestion.testId || null, testName: testQuestion.testName, usedAt: testQuestion.createdAt, tests: new Set([testKey]) });
    else entry.tests.add(testKey);
  }

  items.forEach((item) => {
    const challenge = challengeUsage.get(String(item._id));
    if (challenge) item.usedInChallenge = challenge;
    const test = testUsage.get(String(item._id));
    if (test) item.usedInTest = { testId: test.testId, testName: test.testName, usedAt: test.usedAt, count: test.tests.size };
  });
};

module.exports = { attachUsage };

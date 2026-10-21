const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Question = require('../models/Question');
const ExamQuestion = require('../models/ExamQuestion');
const DailyChallenge = require('../models/DailyChallenge');
const { attachUsage } = require('../utils/questionUsage');

const id = () => new mongoose.Types.ObjectId();

// In-memory stand-ins for the three collections the helper reads.
let copies = []; // challenge copies:   { _id, bankQuestionId | practiceQuestionId }
let testCopies = []; // test copies:   { bankQuestionId | practiceQuestionId, testId, testName, createdAt }
let challenges = []; // daily challenges: { _id, title, startAt, status, questionIds }
let filters = {};

const matchesField = (row, filter) => {
  const field = Object.keys(filter)[0];
  const wanted = new Set(filter[field].$in.map(String));
  return row[field] != null && wanted.has(String(row[field]));
};
const chain = (rows, { sortBy } = {}) => {
  let result = rows;
  const query = {
    select: () => query,
    sort: () => {
      if (sortBy) result = [...result].sort((a, b) => b[sortBy] - a[sortBy]);
      return query;
    },
    lean: async () => result,
  };
  return query;
};

Question.find = (filter) => {
  filters.question = filter;
  return chain(copies.filter((row) => matchesField(row, filter)));
};
ExamQuestion.find = (filter) => {
  filters.exam = filter;
  return chain(testCopies.filter((row) => matchesField(row, filter)), { sortBy: 'createdAt' });
};
DailyChallenge.find = (filter) => {
  const wanted = new Set(filter.questionIds.$in.map(String));
  return chain(challenges.filter((c) => c.questionIds.some((q) => wanted.has(String(q)))), { sortBy: 'startAt' });
};

test.beforeEach(() => {
  copies = [];
  testCopies = [];
  challenges = [];
  filters = {};
});

for (const field of ['bankQuestionId', 'practiceQuestionId']) {
  test(`${field}: shows the latest challenge and test a question was used in, with counts`, async () => {
    const used = { _id: id() };
    const unused = { _id: id() };
    const copyA = { _id: id(), [field]: used._id };
    const copyB = { _id: id(), [field]: used._id };
    copies = [copyA, copyB];
    challenges = [
      { _id: id(), title: 'Week 1', startAt: new Date(2026, 0, 1), status: 'expired', questionIds: [copyA._id] },
      { _id: id(), title: 'Week 2', startAt: new Date(2026, 0, 8), status: 'published', questionIds: [copyB._id, id()] },
    ];
    const testA = id();
    const testB = id();
    testCopies = [
      { [field]: used._id, testId: testA, testName: 'Mock 1', createdAt: new Date(2026, 1, 1) },
      { [field]: used._id, testId: testB, testName: 'Mock 2', createdAt: new Date(2026, 1, 9) },
      { [field]: used._id, testId: testB, testName: 'Mock 2', createdAt: new Date(2026, 1, 10) },
    ];

    const items = [used, unused];
    await attachUsage(items, field);

    assert.equal(items[0].usedInChallenge.title, 'Week 2', 'the most recent challenge');
    assert.equal(items[0].usedInChallenge.count, 2, 'used in two challenges');
    assert.equal(items[0].usedInTest.testName, 'Mock 2', 'the most recent test');
    assert.equal(items[0].usedInTest.count, 2, 'two copies in one test count once');
    assert.equal(items[1].usedInChallenge, undefined);
    assert.equal(items[1].usedInTest, undefined);
  });
}

test('each source is looked up by its own field, so one list never picks up the other', async () => {
  const item = { _id: id() };
  await attachUsage([item], 'practiceQuestionId');
  assert.deepEqual(Object.keys(filters.question), ['practiceQuestionId']);
  assert.deepEqual(Object.keys(filters.exam), ['practiceQuestionId']);

  // A bank copy that happens to share the id must not flag a practice question.
  copies = [{ _id: id(), bankQuestionId: item._id }];
  testCopies = [{ bankQuestionId: item._id, testId: id(), testName: 'Mock', createdAt: new Date() }];
  await attachUsage([item], 'practiceQuestionId');
  assert.equal(item.usedInTest, undefined);
  assert.equal(item.usedInChallenge, undefined);
});

test('the bank is the default, so existing callers behave as before', async () => {
  const item = { _id: id() };
  await attachUsage([item]);
  assert.deepEqual(Object.keys(filters.question), ['bankQuestionId']);
});

test('an empty page does no lookups', async () => {
  await attachUsage([], 'practiceQuestionId');
  assert.deepEqual(filters, {});
});

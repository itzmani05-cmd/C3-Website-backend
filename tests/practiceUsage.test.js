process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const PracticeQuestion = require('../models/PracticeQuestion');
const ExamQuestion = require('../models/ExamQuestion');
const Question = require('../models/Question');
const DailyChallenge = require('../models/DailyChallenge');
const practiceRouter = require('../routes/practiceQuestions');

const id = () => new mongoose.Types.ObjectId();

// The list route reads one page of practice questions, then looks up which of them were copied into tests.
let questions = [];
let testCopies = [];
let lastCopyFilter = null;

// No challenge copies in this test; the shared usage helper is tested on its own in questionUsage.test.js.
const empty = () => {
  const query = { select: () => query, sort: () => query, lean: async () => [] };
  return query;
};
Question.find = empty;
DailyChallenge.find = empty;

PracticeQuestion.countDocuments = async () => questions.length;
PracticeQuestion.aggregate = async () => questions.map((question) => ({ ...question }));
ExamQuestion.find = (filter) => {
  lastCopyFilter = filter;
  const wanted = new Set(filter.practiceQuestionId.$in.map(String));
  let rows = testCopies.filter((copy) => wanted.has(String(copy.practiceQuestionId)));
  const query = {
    select: () => query,
    sort: () => {
      rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      return query;
    },
    lean: async () => rows,
  };
  return query;
};

const app = express();
app.use(express.json());
app.use('/api/practice-questions', practiceRouter);

let server;
let base;
const adminToken = jwt.sign({ email: 'admin@example.com', role: 'Admin' }, process.env.JWT_SECRET);
const studentToken = jwt.sign({ email: 'student@example.com', role: 'student' }, process.env.JWT_SECRET);
// The route needs a scope (topic, unit or exam), as the picker always sends.
const list = async (token = adminToken) => {
  const response = await fetch(`${base}/api/practice-questions?examId=${id()}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('practice questions already copied into a test are flagged with the latest test and how many tests use them', async () => {
  const used = { _id: id(), question: 'Used in two tests' };
  const alsoUsed = { _id: id(), question: 'Used in one test' };
  const unused = { _id: id(), question: 'Never used' };
  questions = [used, alsoUsed, unused];
  const testA = id();
  const testB = id();
  testCopies = [
    { practiceQuestionId: used._id, testId: testA, testName: 'Mock Test 1', createdAt: new Date(2026, 0, 1) },
    { practiceQuestionId: used._id, testId: testB, testName: 'Mock Test 2', createdAt: new Date(2026, 0, 5) },
    { practiceQuestionId: used._id, testId: testB, testName: 'Mock Test 2', createdAt: new Date(2026, 0, 6) },
    { practiceQuestionId: alsoUsed._id, testId: testA, testName: 'Mock Test 1', createdAt: new Date(2026, 0, 2) },
  ];

  const { status, body } = await list();
  assert.equal(status, 200);
  const byQuestion = Object.fromEntries(body.items.map((item) => [item.question, item]));

  assert.equal(byQuestion['Used in two tests'].usedInTest.testName, 'Mock Test 2', 'shows the most recent test');
  assert.equal(byQuestion['Used in two tests'].usedInTest.count, 2, 'two copies in the same test count as one test');
  assert.equal(byQuestion['Used in one test'].usedInTest.count, 1);
  assert.equal(byQuestion['Never used'].usedInTest, undefined);
  assert.deepEqual(lastCopyFilter.practiceQuestionId.$in.map(String), questions.map((q) => String(q._id)), 'only this page is looked up');
});

test('a page with nothing in it does not query for usage', async () => {
  questions = [];
  lastCopyFilter = null;
  const { status, body } = await list();
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
  assert.equal(lastCopyFilter, null);
});

test('the practice list is still admin only', async () => {
  assert.equal((await list(studentToken)).status, 403);
  const response = await fetch(`${base}/api/practice-questions`);
  assert.equal(response.status, 401);
});

test('a test question remembers which practice question it came from', () => {
  const practiceId = id();
  const copy = new ExamQuestion({
    testName: 'Mock Test 1',
    question: 'What is the unit of stress?',
    practiceQuestionId: practiceId,
  });
  assert.equal(String(copy.practiceQuestionId), String(practiceId));
  assert.equal(copy.bankQuestionId, null, 'it is not also marked as coming from the Question Bank');
  assert.equal(copy.validateSync(), undefined);

  const fromBank = new ExamQuestion({ testName: 'Mock Test 1', question: 'Q', bankQuestionId: id() });
  assert.equal(fromBank.practiceQuestionId, null);
});

process.env.JWT_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const Feedback = require('../models/Feedback');
const feedbackRouter = require('../routes/feedback');

// ---- a tiny in-memory stand-in for the Feedback collection, so the route is tested without a database ----
let store = [];
const id = () => new mongoose.Types.ObjectId();
const sameId = (a, b) => String(a) === String(b);

function matches(doc, filter) {
  if (filter.status && doc.status !== filter.status) return false;
  if (filter.category && doc.category !== filter.category) return false;
  if (filter.$or) return filter.$or.some((clause) => Object.entries(clause).every(([field, pattern]) => pattern.test(doc[field] || '')));
  return true;
}

Feedback.countDocuments = async (filter = {}) => store.filter((doc) => matches(doc, filter)).length;
Feedback.aggregate = async () => {
  const rated = store.filter((doc) => doc.rating != null);
  return rated.length ? [{ _id: null, average: rated.reduce((sum, doc) => sum + doc.rating, 0) / rated.length, count: rated.length }] : [];
};
Feedback.find = (filter) => {
  let rows = store.filter((doc) => matches(doc, filter));
  const query = {
    sort: () => {
      rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      return query;
    },
    skip: (n) => {
      rows = rows.slice(n);
      return query;
    },
    limit: (n) => {
      rows = rows.slice(0, n);
      return query;
    },
    lean: async () => rows.map((doc) => ({ ...doc })),
  };
  return query;
};
Feedback.findByIdAndUpdate = (feedbackId, update) => ({
  lean: async () => {
    const doc = store.find((item) => sameId(item._id, feedbackId));
    if (!doc) return null;
    Object.assign(doc, update);
    return { ...doc };
  },
});
Feedback.findByIdAndDelete = (feedbackId) => ({
  lean: async () => {
    const index = store.findIndex((item) => sameId(item._id, feedbackId));
    return index === -1 ? null : store.splice(index, 1)[0];
  },
});

const makeDoc = (n, extra = {}) => ({
  _id: id(),
  userId: id(),
  studentName: `Student ${n}`,
  studentEmail: `student${n}@example.com`,
  category: 'general',
  rating: null,
  message: `Feedback message number ${n}`,
  platform: 'android',
  appVersion: '2.0.0',
  status: 'open',
  reviewedAt: null,
  createdAt: new Date(2026, 0, n),
  ...extra,
});

const app = express();
app.use(express.json());
app.use('/api/feedback', feedbackRouter);

let server;
let base;
const adminToken = jwt.sign({ email: 'admin@example.com', role: 'Admin' }, process.env.JWT_SECRET);
const studentToken = jwt.sign({ email: 'student@example.com', role: 'student' }, process.env.JWT_SECRET);

const call = async (path, { method = 'GET', token = adminToken, body } = {}) => {
  const response = await fetch(`${base}/api/feedback${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
test.beforeEach(() => {
  store = [
    makeDoc(1, { rating: 5, category: 'suggestion' }),
    makeDoc(2, { rating: 3, category: 'bug', status: 'reviewed', reviewedAt: new Date() }),
    makeDoc(3),
    makeDoc(4, { rating: 4, category: 'content', studentEmail: 'priya.k@example.com', studentName: 'Priya K' }),
    makeDoc(5, { message: 'The timer feels too short (really!)' }),
  ];
});

test('only admins can open the inbox', async () => {
  assert.equal((await call('', { token: null })).status, 401);
  assert.equal((await call('', { token: 'garbage' })).status, 401);
  assert.equal((await call('', { token: studentToken })).status, 403);
  assert.equal((await call('')).status, 200);
});

test('the list is newest first, paged, and carries the stat-card numbers', async () => {
  const { body } = await call('?pageSize=2');
  assert.deepEqual(body.items.map((item) => item.message), ['The timer feels too short (really!)', 'Feedback message number 4']);
  assert.equal(body.total, 5);
  assert.equal(body.totalPages, 3);
  assert.deepEqual(body.counts, { total: 5, open: 4, reviewed: 1 });
  assert.deepEqual(body.rating, { average: 4, count: 3 });
  assert.equal(body.items[1].student.email, 'priya.k@example.com');
  assert.equal(body.items[1].rating, 4);
});

test('a page past the end shows the last page, and the page size is capped', async () => {
  const far = await call('?pageSize=2&page=99');
  assert.equal(far.body.page, 3);
  assert.equal(far.body.items.length, 1);
  assert.equal((await call('?pageSize=5000')).body.pageSize, 50);
  assert.equal((await call('?pageSize=abc&page=-3')).body.pageSize, 10);
});

test('filters by status and category', async () => {
  assert.equal((await call('?status=reviewed')).body.total, 1);
  assert.equal((await call('?status=open')).body.total, 4);
  assert.equal((await call('?category=bug')).body.items[0].category, 'bug');
  assert.equal((await call('?status=nonsense')).body.total, 5, 'an unknown status is ignored, not an error');
});

test('search matches the message, name or email, ignoring case', async () => {
  assert.equal((await call('?search=PRIYA')).body.total, 1);
  assert.equal((await call('?search=timer')).body.total, 1);
  assert.equal((await call('?search=student3@')).body.total, 1);
});

test('search text is taken literally, so regex characters cannot match everything', async () => {
  assert.equal((await call('?search=.*')).body.total, 0);
  assert.equal((await call('?search=(really!)')).body.total, 1);
  assert.equal((await call('?search=%5B')).status, 200, 'an unbalanced bracket must not crash the route');
});

test('a message can be marked reviewed and opened again', async () => {
  const target = store[2];
  const reviewed = await call(`/${target._id}`, { method: 'PATCH', body: { status: 'reviewed' } });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, 'reviewed');
  assert.ok(reviewed.body.reviewedAt);

  const reopened = await call(`/${target._id}`, { method: 'PATCH', body: { status: 'open' } });
  assert.equal(reopened.body.status, 'open');
  assert.equal(reopened.body.reviewedAt, null);
});

test('bad status changes are rejected', async () => {
  const target = store[0];
  assert.equal((await call(`/${target._id}`, { method: 'PATCH', body: { status: 'archived' } })).status, 400);
  assert.equal((await call(`/${target._id}`, { method: 'PATCH', body: {} })).status, 400);
  assert.equal((await call(`/${id()}`, { method: 'PATCH', body: { status: 'reviewed' } })).status, 404);
  assert.equal((await call('/not-an-id', { method: 'PATCH', body: { status: 'reviewed' } })).status, 404);
  assert.equal((await call(`/${target._id}`, { method: 'PATCH', token: studentToken, body: { status: 'reviewed' } })).status, 403);
});

test('a message can be deleted once', async () => {
  const target = store[1];
  assert.equal((await call(`/${target._id}`, { method: 'DELETE' })).status, 200);
  assert.equal(store.length, 4);
  assert.equal((await call(`/${target._id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await call('/not-an-id', { method: 'DELETE' })).status, 404);
  assert.equal((await call(`/${store[0]._id}`, { method: 'DELETE', token: studentToken })).status, 403);
  assert.equal(store.length, 4, 'a student cannot delete feedback');
});

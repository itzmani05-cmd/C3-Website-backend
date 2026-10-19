const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const QuestionBankQuestion = require('../models/QuestionBankQuestion');
const QuestionBankAudit = require('../models/QuestionBankAudit');
const Question = require('../models/Question');
const ExamQuestion = require('../models/ExamQuestion');
const DailyChallenge = require('../models/DailyChallenge');
const Topic = require('../models/Topic');
const Unit = require('../models/Unit');
const { verifyToken } = require('./auth');

router.use(verifyToken);

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

// ---------- limits ----------

const MAX_IMAGE_BYTES = 150 * 1024;
// Per-image caps alone still allow 6 x 150KB; cap the whole question so documents stay small.
const MAX_TOTAL_IMAGE_BYTES = 500 * 1024;

const base64ByteLength = (value) => {
  if (typeof value !== 'string' || !value) return 0;
  const data = value.includes(',') ? value.split(',')[1] : value;
  return Buffer.byteLength(data, 'base64');
};

const findOversizedImage = (body) => {
  if (!body || typeof body !== 'object') return null;
  const images = [
    ['Question image', body.questionImage],
    ['Explanation image', body.explanationImage],
    ...Object.entries(body.optionImages || {}).map(([key, value]) => [`Option ${String(key).toUpperCase()} image`, value])
  ];
  let total = 0;
  for (const [label, value] of images) {
    const bytes = base64ByteLength(value);
    if (bytes > MAX_IMAGE_BYTES) return `${label} is too large. Maximum allowed size is 150KB.`;
    total += bytes;
  }
  if (total > MAX_TOTAL_IMAGE_BYTES) return 'The images on this question add up to more than 500KB. Remove or shrink some of them.';
  return null;
};

const EDITABLE_FIELDS = [
  'type', 'answerType', 'question', 'questionImage', 'options', 'optionImages',
  'correct_answer', 'explanation', 'explanationImage', 'year', 'source',
  'marks', 'answerMin', 'answerMax', 'verified'
];

const pickEditable = (body) =>
  EDITABLE_FIELDS.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const oid = (id) => new mongoose.Types.ObjectId(id);

const respondError = (res, error) => {
  const isValidation = error.name === 'ValidationError';
  res.status(isValidation ? 400 : 500).json({ message: isValidation ? error.message : 'Server error', error: error.message });
};

const currentUser = (req) => (req.user && req.user.email) || 'unknown';

// Fire-and-forget: a failing audit write must never fail the actual change.
const audit = (req, action, extra = {}) => {
  QuestionBankAudit.create({ action, by: currentUser(req), ...extra }).catch((e) => console.error('audit log failed:', e.message));
};

// ---------- counts cache ----------

// Per-topic counts need a full-collection $group, so keep the result briefly and drop it on any add/delete.
const COUNTS_TTL_MS = 60 * 1000;
let countsCache = { at: 0, data: null };
const invalidateCounts = () => { countsCache = { at: 0, data: null }; };

// Question counts per topic: { [topicId]: count }
router.get('/counts', isAdmin, async (req, res) => {
  try {
    if (countsCache.data && Date.now() - countsCache.at < COUNTS_TTL_MS) return res.json(countsCache.data);
    const rows = await QuestionBankQuestion.aggregate([{ $group: { _id: '$topicId', count: { $sum: 1 } } }]);
    const counts = {};
    rows.forEach((r) => { counts[r._id.toString()] = r.count; });
    countsCache = { at: Date.now(), data: counts };
    res.json(counts);
  } catch (error) {
    respondError(res, error);
  }
});

// ---------- list ----------

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nonEmpty = (field) => ({ [field]: { $nin: [null, ''] } });
const OPTION_KEYS = ['a', 'b', 'c', 'd'];
const IMAGE_FIELDS = ['questionImage', ...OPTION_KEYS.map((k) => `optionImages.${k}`)];

const toNumber = (v) => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? null : n;
};

/**
 * Builds a Mongo match from a scope (topicId | unitId | examId) plus optional filters:
 *   q, yearFrom, yearTo, answerType (csv), marks (csv), hasImage=1, missingExplanation=1,
 *   rangeAnswer=1
 * Returns { match } or { error }.
 */
const buildMatch = (query) => {
  const match = {};
  const and = [];

  const scopeKey = ['topicId', 'unitId', 'examId'].find((k) => query[k]);
  if (!scopeKey) return { error: 'A topicId, unitId or examId is required' };
  if (!isValidId(query[scopeKey])) return { error: `Invalid ${scopeKey}` };
  match[scopeKey] = oid(query[scopeKey]);

  const text = typeof query.q === 'string' ? query.q.trim() : '';
  if (text) {
    const re = new RegExp(escapeRegex(text), 'i');
    and.push({ $or: [{ question: re }, { explanation: re }, { source: re }, ...OPTION_KEYS.map((k) => ({ [`options.${k}`]: re }))] });
  }

  const yearFrom = toNumber(query.yearFrom);
  const yearTo = toNumber(query.yearTo);
  if (yearFrom !== null || yearTo !== null) {
    match.year = {};
    if (yearFrom !== null) match.year.$gte = yearFrom;
    if (yearTo !== null) match.year.$lte = yearTo;
  }

  if (query.answerType) {
    const types = String(query.answerType).split(',').filter((t) => ['single', 'multiple', 'numerical'].includes(t));
    if (types.length) match.answerType = { $in: types };
  }

  if (query.marks) {
    const marks = String(query.marks).split(',').map(toNumber).filter((m) => m !== null);
    if (marks.length) match.marks = { $in: marks };
  }

  if (query.hasImage === '1') and.push({ $or: IMAGE_FIELDS.map(nonEmpty) });

  if (query.missingExplanation === '1') {
    and.push({ explanation: { $not: /\S/ } });
    and.push({ explanationImage: { $in: [null, ''] } });
  }

  if (query.rangeAnswer === '1') {
    match.answerType = 'numerical';
    and.push({ answerMin: { $ne: null } }, { answerMax: { $ne: null } }, { $expr: { $ne: ['$answerMin', '$answerMax'] } });
  }

  if (and.length) match.$and = and;
  return { match };
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Flags the questions that were already used, so admins can avoid picking the same one twice:
//  - usedInChallenge: the latest Daily Challenge that has it (challenges hold copies, linked by bankQuestionId)
//  - usedInTest: the latest test it was copied into, and how many tests use it
const attachUsage = async (items) => {
  if (items.length === 0) return;
  const ids = items.map((i) => i._id);
  const [copies, testQuestions] = await Promise.all([
    Question.find({ bankQuestionId: { $in: ids } }).select('_id bankQuestionId').lean(),
    ExamQuestion.find({ bankQuestionId: { $in: ids } }).select('bankQuestionId testId testName createdAt').sort({ createdAt: -1 }).lean()
  ]);

  const challengeUsage = new Map();
  if (copies.length > 0) {
    const bankIdByCopy = new Map(copies.map((c) => [String(c._id), String(c.bankQuestionId)]));
    const challenges = await DailyChallenge.find({ questionIds: { $in: copies.map((c) => c._id) } })
      .select('title startAt status questionIds')
      .sort({ startAt: -1 })
      .lean();
    for (const challenge of challenges) {
      for (const copyId of challenge.questionIds) {
        const bankId = bankIdByCopy.get(String(copyId));
        if (!bankId) continue;
        const entry = challengeUsage.get(bankId);
        if (entry) entry.count += 1;
        else challengeUsage.set(bankId, { challengeId: challenge._id, title: challenge.title, startAt: challenge.startAt, status: challenge.status, count: 1 });
      }
    }
  }

  const testUsage = new Map();
  for (const tq of testQuestions) {
    const bankId = String(tq.bankQuestionId);
    const testKey = String(tq.testId || tq.testName);
    const entry = testUsage.get(bankId);
    if (!entry) testUsage.set(bankId, { testId: tq.testId || null, testName: tq.testName, usedAt: tq.createdAt, tests: new Set([testKey]) });
    else entry.tests.add(testKey);
  }

  items.forEach((item) => {
    const challenge = challengeUsage.get(String(item._id));
    if (challenge) item.usedInChallenge = challenge;
    const test = testUsage.get(String(item._id));
    if (test) item.usedInTest = { testId: test.testId, testName: test.testName, usedAt: test.usedAt, count: test.tests.size };
  });
};

const hasText = (field) => ({ $gt: [{ $strLenCP: { $ifNull: [field, ''] } }, 0] });
const hasNonBlankText = (field) => ({ $gt: [{ $strLenCP: { $trim: { input: { $ifNull: [field, ''] } } } }, 0] });

// One page of questions with everything needed to show and edit them except the base64 images, which are the bulk of
// each document: those are left out and reported as hasQuestionImage / hasOptionImages / hasExplanationImage flags.
router.get('/', isAdmin, async (req, res) => {
  try {
    const { match, error } = buildMatch(req.query);
    if (error) return res.status(400).json({ message: error });

    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
    const total = await QuestionBankQuestion.countDocuments(match);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(totalPages, Math.max(1, parseInt(req.query.page, 10) || 1));

    const items = await QuestionBankQuestion.aggregate([
      { $match: match },
      { $sort: { createdAt: 1, _id: 1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $addFields: {
          hasQuestionImage: hasText('$questionImage'),
          hasExplanationImage: hasText('$explanationImage'),
          hasOptionImages: { $or: OPTION_KEYS.map((k) => hasText(`$optionImages.${k}`)) },
          hasExplanation: hasNonBlankText('$explanation')
        }
      },
      { $project: { questionImage: 0, explanationImage: 0, optionImages: 0 } }
    ]);
    await attachUsage(items);
    res.json({ items, total, page, limit, totalPages });
  } catch (error) {
    respondError(res, error);
  }
});

// ---------- single question ----------

// Full question, images included.
router.get('/:id', isAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid id' });
    const question = await QuestionBankQuestion.findById(req.params.id).lean();
    if (!question) return res.status(404).json({ message: 'Question not found' });
    res.json(question);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/', isAdmin, async (req, res) => {
  try {
    const { topicId } = req.body;
    if (!topicId || !isValidId(topicId)) {
      return res.status(400).json({ message: 'A valid topicId is required' });
    }
    const topic = await Topic.findById(topicId);
    if (!topic) return res.status(400).json({ message: 'Invalid topicId' });
    const unit = await Unit.findById(topic.unitId);

    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) return res.status(413).json({ message: oversizedImageError });

    const question = new QuestionBankQuestion({
      ...pickEditable(req.body),
      topicId: topic._id,
      unitId: topic.unitId,
      examId: unit ? unit.examId : null,
      updatedBy: currentUser(req)
    });
    await question.save();
    invalidateCounts();
    audit(req, 'create', { questionId: question._id, topicId: topic._id, summary: 'Added a question' });
    res.status(201).json(question);
  } catch (error) {
    respondError(res, error);
  }
});

router.put('/:id', isAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid id' });
    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) return res.status(413).json({ message: oversizedImageError });

    const question = await QuestionBankQuestion.findById(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found' });

    // Image fields are only changed when they are sent. optionImages is merged key by key, so sending one option's
    // image never clears the others (the list does not load images, so the editor only knows what was just uploaded).
    const { optionImages, ...fields } = pickEditable(req.body);
    question.set(fields);
    if (optionImages && typeof optionImages === 'object') {
      Object.entries(optionImages).forEach(([key, value]) => {
        if (OPTION_KEYS.includes(key)) question.set(`optionImages.${key}`, value);
      });
    }

    question.updatedBy = currentUser(req);
    if (question.isModified('verified')) {
      question.verifiedBy = question.verified ? currentUser(req) : '';
      question.verifiedAt = question.verified ? new Date() : null;
    }
    const changed = question.modifiedPaths().filter((p) => !['updatedBy', 'updatedAt'].includes(p));
    await question.save();
    audit(req, 'update', { questionId: question._id, topicId: question.topicId, summary: `Edited: ${changed.join(', ') || 'no field changes'}` });
    res.json(question);
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/topic/:topicId', isAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.topicId)) return res.status(400).json({ message: 'Invalid topicId' });
    const result = await QuestionBankQuestion.deleteMany({ topicId: req.params.topicId });
    invalidateCounts();
    audit(req, 'delete-topic', { topicId: req.params.topicId, count: result.deletedCount, summary: `Deleted all ${result.deletedCount} question(s) in a topic` });
    res.json({ message: `Deleted ${result.deletedCount} question(s)`, deletedCount: result.deletedCount });
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/:id', isAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid id' });
    const question = await QuestionBankQuestion.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found' });
    invalidateCounts();
    audit(req, 'delete', { questionId: question._id, topicId: question.topicId, summary: `Deleted: ${String(question.question).slice(0, 80)}` });
    res.json({ message: 'Question deleted' });
  } catch (error) {
    respondError(res, error);
  }
});

module.exports = router;

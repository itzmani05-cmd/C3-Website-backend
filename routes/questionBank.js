const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const QuestionBankQuestion = require('../models/QuestionBankQuestion');
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

const MAX_IMAGE_BYTES = 150 * 1024;

const base64ByteLength = (value) => {
  if (typeof value !== 'string' || !value) return 0;
  const data = value.includes(',') ? value.split(',')[1] : value;
  return Buffer.byteLength(data, 'base64');
};

const findOversizedImage = (body) => {
  if (!body || typeof body !== 'object') return null;
  if (base64ByteLength(body.questionImage) > MAX_IMAGE_BYTES) return 'Question image is too large. Maximum allowed size is 150KB.';
  if (base64ByteLength(body.explanationImage) > MAX_IMAGE_BYTES) return 'Explanation image is too large. Maximum allowed size is 150KB.';
  for (const [key, value] of Object.entries(body.optionImages || {})) {
    if (base64ByteLength(value) > MAX_IMAGE_BYTES) {
      return `Option ${String(key).toUpperCase()} image is too large. Maximum allowed size is 150KB.`;
    }
  }
  return null;
};

const EDITABLE_FIELDS = [
  'type', 'answerType', 'question', 'questionImage', 'options', 'optionImages',
  'correct_answer', 'explanation', 'explanationImage'
];

const pickEditable = (body) =>
  EDITABLE_FIELDS.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const respondError = (res, error) => {
  const isValidation = error.name === 'ValidationError';
  res.status(isValidation ? 400 : 500).json({ message: isValidation ? error.message : 'Server error', error: error.message });
};

// Question counts per topic: { [topicId]: count }
router.get('/counts', isAdmin, async (req, res) => {
  try {
    const rows = await QuestionBankQuestion.aggregate([{ $group: { _id: '$topicId', count: { $sum: 1 } } }]);
    const counts = {};
    rows.forEach((r) => { counts[r._id.toString()] = r.count; });
    res.json(counts);
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/', isAdmin, async (req, res) => {
  try {
    const { topicId } = req.query;
    if (!topicId || !isValidId(topicId)) {
      return res.status(400).json({ message: 'A valid topicId is required' });
    }
    const questions = await QuestionBankQuestion.find({ topicId }).sort({ createdAt: 1 });
    res.json(questions);
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
      examId: unit ? unit.examId : null
    });
    await question.save();
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

    question.set(pickEditable(req.body));
    await question.save();
    res.json(question);
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/topic/:topicId', isAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.topicId)) return res.status(400).json({ message: 'Invalid topicId' });
    const result = await QuestionBankQuestion.deleteMany({ topicId: req.params.topicId });
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
    res.json({ message: 'Question deleted' });
  } catch (error) {
    respondError(res, error);
  }
});

module.exports = router;

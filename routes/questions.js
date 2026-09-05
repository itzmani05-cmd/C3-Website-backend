const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Question = require('../models/Question');
const Unit = require('../models/Unit');
const Topic = require('../models/Topic');
const Subtopic = require('../models/Subtopic');
const Test = require('../models/Test');
const Exam = require('../models/Exam');
const ExamQuestion = require('../models/ExamQuestion');
const StudentExam = require('../models/StudentExam');
const DailyQuestion = require('../models/DailyQuestion');
const DailyChallenge = require('../models/DailyChallenge');
const DailyChallengeAttempt = require('../models/DailyChallengeAttempt');
const User = require('../models/User');
const { verifyToken } = require('./auth');

// This entire router manages authored content (curriculum, questions, tests, exams) —
// every route requires a logged-in user; individual routes further restrict to admins below.
router.use(verifyToken);

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

const MAX_IMAGE_BYTES = 150 * 1024; // 150KB — images are stored inline as base64 in MongoDB documents,
// and a question can carry up to 6 of them (question + 4 options + explanation), so unbounded
// uploads risk bloating documents (Daily Challenges snapshot-copy question images too).

function base64ByteLength(value) {
  if (typeof value !== 'string' || !value) return 0;
  const data = value.includes(',') ? value.split(',')[1] : value;
  return Buffer.byteLength(data, 'base64');
}

// Checks every image-bearing field a question payload can carry (questionImage, explanationImage,
// optionImages as either an {a,b,c,d} map or an array) and returns an error message if any exceeds
// MAX_IMAGE_BYTES, or null if all are within limit. Call this before saving any question-shaped body.
function findOversizedImage(body) {
  if (!body || typeof body !== 'object') return null;

  if (base64ByteLength(body.questionImage) > MAX_IMAGE_BYTES) {
    return 'Question image is too large. Maximum allowed size is 150KB.';
  }
  if (base64ByteLength(body.explanationImage) > MAX_IMAGE_BYTES) {
    return 'Explanation image is too large. Maximum allowed size is 150KB.';
  }

  const optionImages = body.optionImages;
  if (optionImages && typeof optionImages === 'object') {
    const entries = Array.isArray(optionImages) ? optionImages.entries() : Object.entries(optionImages);
    for (const [key, value] of entries) {
      if (base64ByteLength(value) > MAX_IMAGE_BYTES) {
        return `Option ${typeof key === 'number' ? key + 1 : String(key).toUpperCase()} image is too large. Maximum allowed size is 150KB.`;
      }
    }
  }

  return null;
}

// Curriculum browsing is the one route students can also hit directly (soft-scoped to
// their own enrolled exam(s) below) — every other route in this file is admin-only.
// Returns null for non-students (no restriction), or the (possibly empty) list of exam
// ids a student is enrolled in — an empty list must still filter results down to nothing,
// not fall back to "unrestricted".
const getStudentExamIds = async (req) => {
  if (!req.user || req.user.role !== 'student') return null;
  const student = await User.findOne({ email: req.user.email }).select('examIds');
  return (student?.examIds || []).map((id) => id.toString());
};

// Get all questions
router.get('/', isAdmin, async (req, res) => {
  try {
    const { unitId, topicId, subtopicId, status } = req.query;
    let query = {};

    if (unitId) query.unitId = unitId;
    if (topicId) query.topicId = topicId;
    if (subtopicId) query.subtopicId = subtopicId;
    if (status) query.status = status;

    const questions = await Question.find(query).sort({ timestamp: -1 });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', isAdmin, async (req, res) => {
  try {
    const { unitId, topicId, subtopicId } = req.body;

    if (!unitId) {
      return res.status(400).json({ message: 'unitId is required' });
    }
    if (!topicId) {
      req.body.topicId = null;
    }
    if (!subtopicId) {
      req.body.subtopicId = null;
    }

    if (req.body.subtopicId) {
      const subtopic = await Subtopic.findById(req.body.subtopicId);

      if (!subtopic) {
        return res.status(400).json({ message: 'Invalid subtopicId' });
      }

      if (topicId && subtopic.topicId.toString() !== topicId) {
        return res.status(400).json({
          message: 'subtopic does not belong to given topic'
        });
      }
    }

    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    const question = new Question(req.body);
    await question.save();

    res.status(201).json(question);

  } catch (error) {
    console.error("🔥 ERROR:", error);
    console.error("🔥 BODY:", req.body);

    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});

// Get all exams (site is scaling to cover multiple exams, e.g. TNPSC AE, TRB, etc.)
router.get('/exams', isAdmin, async (req, res) => {
  try {
    const exams = await Exam.find().sort({ name: 1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving exams', error: error.message });
  }
});

// Create an Exam
router.post('/exams', isAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Exam name is required' });
    }

    const existing = await Exam.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ message: 'An exam with this name already exists' });
    }

    const exam = new Exam({ name: name.trim() });
    await exam.save();
    res.status(201).json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating exam', error: error.message });
  }
});

// Update an Exam
router.put('/exams/:id', isAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Exam name cannot be empty' });
    }

    const exam = await Exam.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    res.json(exam);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating exam', error: error.message });
  }
});

// Delete an Exam (cascades to everything scoped under it: units/topics/subtopics/
// questions, tests/exam questions/student attempts, daily challenges/attempts, and
// unenrolls any student who had it in their examIds)
router.delete('/exams/:id', isAdmin, async (req, res) => {
  try {
    const examId = req.params.id;
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    const units = await Unit.find({ examId });
    const unitIds = units.map((u) => u._id);
    const topics = await Topic.find({ unitId: { $in: unitIds } });
    const topicIds = topics.map((t) => t._id);
    const subtopics = await Subtopic.find({ topicId: { $in: topicIds } });
    const subtopicIds = subtopics.map((st) => st._id);

    await Question.deleteMany({
      $or: [
        { unitId: { $in: unitIds } },
        { topicId: { $in: topicIds } },
        { subtopicId: { $in: subtopicIds } }
      ]
    });
    await Subtopic.deleteMany({ topicId: { $in: topicIds } });
    await Topic.deleteMany({ unitId: { $in: unitIds } });
    await Unit.deleteMany({ examId });

    const tests = await Test.find({ examId });
    const testIds = tests.map((t) => t._id);
    const testNames = tests.map((t) => t.name);
    await ExamQuestion.deleteMany({ $or: [{ testId: { $in: testIds } }, { testName: { $in: testNames } }] });
    await StudentExam.deleteMany({ $or: [{ testId: { $in: testIds } }, { testName: { $in: testNames } }] });
    await Test.deleteMany({ examId });

    const dailyChallenges = await DailyChallenge.find({ examId });
    const dailyChallengeIds = dailyChallenges.map((c) => c._id);
    await DailyChallengeAttempt.deleteMany({ challengeId: { $in: dailyChallengeIds } });
    await DailyChallenge.deleteMany({ examId });

    await User.updateMany({ examIds: examId }, { $pull: { examIds: examId } });

    await Exam.findByIdAndDelete(examId);

    res.json({ message: 'Exam and all associated units, tests, daily challenges, and results deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting exam', error: error.message });
  }
});

// Get all tests (for extractor/admin destination setup), optionally scoped to an exam
router.get('/tests', isAdmin, async (req, res) => {
  try {
    const { examId } = req.query;
    const query = examId ? { examId } : {};
    const tests = await Test.find(query).sort({ name: 1 }).populate('examId', 'name');
    res.json(tests);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving tests', error: error.message });
  }
});

// Create a Test
router.post('/tests', isAdmin, async (req, res) => {
  try {
    const { name, publishToStudent, examId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Test name is required' });
    }
    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(400).json({ message: 'Exam not found' });
    }

    const existing = await Test.findOne({ name: name.trim(), examId });
    if (existing) {
      return res.status(400).json({ message: 'A test with this name already exists for this exam' });
    }

    const test = new Test({ name: name.trim(), publishToStudent: !!publishToStudent, examId });
    await test.save();
    res.status(201).json(test);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating test', error: error.message });
  }
});

// Update a Test
router.put('/tests/:id', isAdmin, async (req, res) => {
  try {
    const { name, publishToStudent, examId } = req.body;
    const update = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: 'Test name cannot be empty' });
      }
      update.name = name.trim();
    }
    if (publishToStudent !== undefined) {
      update.publishToStudent = !!publishToStudent;
    }
    if (examId !== undefined) {
      update.examId = examId;
    }

    const test = await Test.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    ).populate('examId', 'name');
    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }
    res.json(test);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating test', error: error.message });
  }
});

// Delete a Test (Cascade deletion of ExamQuestions and StudentExam attempts)
router.delete('/tests/:id', isAdmin, async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await Test.findById(testId);
    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }

    await ExamQuestion.deleteMany({ $or: [{ testId }, { testName: test.name }] });
    await StudentExam.deleteMany({ $or: [{ testId }, { testName: test.name }] });
    await Test.findByIdAndDelete(testId);

    res.json({ message: 'Test and all associated exam questions and student attempts deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting test', error: error.message });
  }
});

// Create/save an exam question (for test extractor destination)
router.post('/exam', isAdmin, async (req, res) => {
  try {
    const { testName } = req.body;
    if (!testName) {
      return res.status(400).json({ message: 'testName is required' });
    }

    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    const examQuestion = new ExamQuestion(req.body);
    await examQuestion.save();

    res.status(201).json(examQuestion);
  } catch (error) {
    console.error("🔥 EXAM QUESTION ERROR:", error);
    res.status(500).json({
      message: 'Server error saving exam question',
      error: error.message
    });
  }
});

// Get all questions belonging to a test (for admin PDF/Word export)
router.get('/exam', isAdmin, async (req, res) => {
  try {
    const { testId, testName } = req.query;
    if (!testId && !testName) {
      return res.status(400).json({ message: 'testId or testName is required' });
    }

    const query = testId ? { testId } : { testName };
    const questions = await ExamQuestion.find(query).sort({ createdAt: 1 });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving exam questions', error: error.message });
  }
});

// Get count of questions in a test
router.get('/exam/count', isAdmin, async (req, res) => {
  try {
    const { testName } = req.query;
    if (!testName) {
      return res.status(400).json({ message: 'testName is required' });
    }
    const count = await ExamQuestion.countDocuments({ testName });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Server error getting question count', error: error.message });
  }
});

// Update a single exam question (for test question fixer)
router.put('/exam/:id', isAdmin, async (req, res) => {
  try {
    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    const examQuestion = await ExamQuestion.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!examQuestion) {
      return res.status(404).json({ message: 'Exam question not found' });
    }
    res.json(examQuestion);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Bulk delete exam questions belonging to a test (keeps the Test itself)
router.delete('/exam/delete/bulk', isAdmin, async (req, res) => {
  try {
    const { testId, testName } = req.query;
    if (!testId && !testName) {
      return res.status(400).json({ message: 'testId or testName is required' });
    }

    const query = testId ? { testId } : { testName };
    const result = await ExamQuestion.deleteMany(query);
    res.json({ message: `Successfully deleted ${result.deletedCount} questions`, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a single exam question
router.delete('/exam/:id', isAdmin, async (req, res) => {
  try {
    const examQuestion = await ExamQuestion.findByIdAndDelete(req.params.id);
    if (!examQuestion) {
      return res.status(404).json({ message: 'Exam question not found' });
    }
    res.json({ message: 'Exam question deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all daily questions (optionally filtered by date, for daily-questions admin list)
router.get('/daily', isAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    const query = date ? { date } : {};
    const questions = await DailyQuestion.find(query).sort({ date: -1, createdAt: -1 });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving daily questions', error: error.message });
  }
});

// Create/save a daily question (for daily-questions extractor destination)
router.post('/daily', isAdmin, async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ message: 'date is required' });
    }

    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    const dailyQuestion = new DailyQuestion(req.body);
    await dailyQuestion.save();

    res.status(201).json(dailyQuestion);
  } catch (error) {
    console.error("🔥 DAILY QUESTION ERROR:", error);
    res.status(500).json({
      message: 'Server error saving daily question',
      error: error.message
    });
  }
});

// Get count of daily questions for a given date
router.get('/daily/count', isAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'date is required' });
    }
    const count = await DailyQuestion.countDocuments({ date });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Server error getting daily question count', error: error.message });
  }
});

// Update a single daily question (for daily question fixer)
router.put('/daily/:id', isAdmin, async (req, res) => {
  try {
    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    const dailyQuestion = await DailyQuestion.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!dailyQuestion) {
      return res.status(404).json({ message: 'Daily question not found' });
    }
    res.json(dailyQuestion);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Bulk delete daily questions belonging to a date
router.delete('/daily/delete/bulk', isAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ message: 'date is required' });
    }
    const result = await DailyQuestion.deleteMany({ date });
    res.json({ message: `Successfully deleted ${result.deletedCount} questions`, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a single daily question
router.delete('/daily/:id', isAdmin, async (req, res) => {
  try {
    const dailyQuestion = await DailyQuestion.findByIdAndDelete(req.params.id);
    if (!dailyQuestion) {
      return res.status(404).json({ message: 'Daily question not found' });
    }
    res.json({ message: 'Daily question deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/upload', isAdmin, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ message: 'No image provided' });
    }

    if (base64ByteLength(image) > MAX_IMAGE_BYTES) {
      return res.status(413).json({ message: 'Image is too large. Maximum allowed size is 150KB.' });
    }

    res.json({ imageUrl: image });
  } catch (error) {
    res.status(500).json({ message: 'Upload error', error: error.message });
  }
});

router.put('/:id', isAdmin, async (req, res) => {
  try {
    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    const question = await Question.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json(question);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
// Bulk delete questions by topicId or subtopicId
router.delete('/delete/bulk', isAdmin, async (req, res) => {
  try {
    const { topicId, subtopicId } = req.query;
    let query = {};

    if (!topicId && !subtopicId) {
      return res.status(400).json({ message: 'At least topicId or subtopicId is required' });
    }

    if (subtopicId && subtopicId !== 'all') {
      query.subtopicId = subtopicId;
    } else if (topicId && topicId !== 'all') {
      query.topicId = topicId;
    }

    const result = await Question.deleteMany(query);
    res.json({ message: `Successfully deleted ${result.deletedCount} questions`, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', isAdmin, async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json({ message: 'Question deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/stats/count', isAdmin, async (req, res) => {
  try {
    const { unitId, topicId, subtopicId } = req.query;
    let query = {};
    if (unitId) query.unitId = unitId;
    if (topicId) query.topicId = topicId;
    if (subtopicId) query.subtopicId = subtopicId;

    const count = await Question.countDocuments(query);
    res.json({ count, goal: 25 });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/by-subtopic/:subtopicId', isAdmin, async (req, res) => {
  try {
    const questions = await Question.find({ subtopicId: req.params.subtopicId });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/curriculum', async (req, res) => {
  try {
    const { examId } = req.query;
    let unitQuery = examId ? { examId } : {};
    if (!examId) {
      // No explicit exam requested (as admin tools always pass none today) — if the
      // caller is a logged-in student, scope the curriculum to their enrolled exam(s)
      // so they only ever see units for exams they're actually enrolled in. A student
      // enrolled in nothing yet must see nothing, not every exam's units.
      const studentExamIds = await getStudentExamIds(req);
      if (studentExamIds !== null) {
        unitQuery = { examId: { $in: studentExamIds } };
      }
    }
    const units = await Unit.find(unitQuery).sort({ order: 1 });
    const topics = await Topic.find().sort({ order: 1 });
    const subtopics = await Subtopic.find().sort({ order: 1 });
    const hierarchy = [];

    for (const unit of units) {
      const unitData = {
        _id: unit._id.toString(),
        examId: unit.examId.toString(),
        name: unit.name,
        topics: []
      };

      const unitTopics = topics.filter(t => t.unitId.toString() === unit._id.toString());
      for (const topic of unitTopics) {
        const topicData = {
          _id: topic._id.toString(),
          name: topic.name,
          subtopics: []
        };

        const topicSubtopics = subtopics.filter(st => st.topicId.toString() === topic._id.toString());
        for (const subtopic of topicSubtopics) {
          topicData.subtopics.push({
            _id: subtopic._id.toString(),
            name: subtopic.name
          });
        }

        unitData.topics.push(topicData);
      }
      hierarchy.push(unitData);
    }

    res.json(hierarchy);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json(question);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create a Unit
router.post('/units', isAdmin, async (req, res) => {
  try {
    const { name, order, examId } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Unit name is required' });
    }
    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(400).json({ message: 'Exam not found' });
    }
    const unit = new Unit({ name, order: order || 0, examId });
    await unit.save();
    res.status(201).json(unit);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update a Unit
router.put('/units/:id', isAdmin, async (req, res) => {
  try {
    const { name, order, examId } = req.body;
    const update = { name, order };
    if (examId !== undefined) update.examId = examId;
    const unit = await Unit.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );
    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }
    res.json(unit);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a Unit (Cascade deletion of Topics, Subtopics, and Questions)
router.delete('/units/:id', isAdmin, async (req, res) => {
  try {
    const unitId = req.params.id;
    const unit = await Unit.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    // Find topics under this unit
    const topics = await Topic.find({ unitId });
    const topicIds = topics.map(t => t._id);

    // Find subtopics under those topics
    const subtopics = await Subtopic.find({ topicId: { $in: topicIds } });
    const subtopicIds = subtopics.map(st => st._id);

    // Delete all questions associated with this unit, topics, or subtopics
    await Question.deleteMany({
      $or: [
        { unitId },
        { topicId: { $in: topicIds } },
        { subtopicId: { $in: subtopicIds } }
      ]
    });

    // Delete subtopics
    await Subtopic.deleteMany({ topicId: { $in: topicIds } });

    // Delete topics
    await Topic.deleteMany({ unitId });

    // Delete unit
    await Unit.findByIdAndDelete(unitId);

    res.json({ message: 'Unit and all associated topics, subtopics, and questions deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create a Topic
router.post('/topics', isAdmin, async (req, res) => {
  try {
    const { name, unitId, order } = req.body;
    if (!name || !unitId) {
      return res.status(400).json({ message: 'Topic name and unitId are required' });
    }
    const topic = new Topic({ name, unitId, order: order || 0 });
    await topic.save();
    res.status(201).json(topic);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update a Topic
router.put('/topics/:id', isAdmin, async (req, res) => {
  try {
    const { name, unitId, order } = req.body;
    const topic = await Topic.findByIdAndUpdate(
      req.params.id,
      { name, unitId, order },
      { new: true, runValidators: true }
    );
    if (!topic) {
      return res.status(404).json({ message: 'Topic not found' });
    }
    res.json(topic);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a Topic (Cascade deletion of Subtopics and Questions)
router.delete('/topics/:id', isAdmin, async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await Topic.findById(topicId);
    if (!topic) {
      return res.status(404).json({ message: 'Topic not found' });
    }

    // Find subtopics under this topic
    const subtopics = await Subtopic.find({ topicId });
    const subtopicIds = subtopics.map(st => st._id);

    // Delete all questions associated with this topic or its subtopics
    await Question.deleteMany({
      $or: [
        { topicId },
        { subtopicId: { $in: subtopicIds } }
      ]
    });

    // Delete subtopics
    await Subtopic.deleteMany({ topicId });

    // Delete topic
    await Topic.findByIdAndDelete(topicId);

    res.json({ message: 'Topic and all associated subtopics and questions deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create a Subtopic
router.post('/subtopics', isAdmin, async (req, res) => {
  try {
    const { name, topicId, order } = req.body;
    if (!name || !topicId) {
      return res.status(400).json({ message: 'Subtopic name and topicId are required' });
    }
    const subtopic = new Subtopic({ name, topicId, order: order || 0 });
    await subtopic.save();
    res.status(201).json(subtopic);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update a Subtopic
router.put('/subtopics/:id', isAdmin, async (req, res) => {
  try {
    const { name, topicId, order } = req.body;
    const subtopic = await Subtopic.findByIdAndUpdate(
      req.params.id,
      { name, topicId, order },
      { new: true, runValidators: true }
    );
    if (!subtopic) {
      return res.status(404).json({ message: 'Subtopic not found' });
    }
    res.json(subtopic);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a Subtopic (Cascade deletion of Questions)
router.delete('/subtopics/:id', isAdmin, async (req, res) => {
  try {
    const subtopicId = req.params.id;
    const subtopic = await Subtopic.findById(subtopicId);
    if (!subtopic) {
      return res.status(404).json({ message: 'Subtopic not found' });
    }

    // Delete all questions associated with this subtopic
    await Question.deleteMany({ subtopicId });

    // Delete subtopic
    await Subtopic.findByIdAndDelete(subtopicId);

    res.json({ message: 'Subtopic and all associated questions deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Seed curriculum data
router.post('/curriculum/seed', isAdmin, async (req, res) => {
  try {
    const { examId } = req.body;
    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(400).json({ message: 'Exam not found' });
    }

    const existingUnits = await Unit.find({ examId });
    const existingUnitIds = existingUnits.map((u) => u._id);
    const existingTopics = await Topic.find({ unitId: { $in: existingUnitIds } });
    const existingTopicIds = existingTopics.map((t) => t._id);
    await Subtopic.deleteMany({ topicId: { $in: existingTopicIds } });
    await Topic.deleteMany({ unitId: { $in: existingUnitIds } });
    await Unit.deleteMany({ examId });

    const unit1 = await Unit.create({ examId, name: "Unit 1: Building Materials & Construction Practices", order: 1 });
    const topic1_1 = await Topic.create({ name: "Building Materials", unitId: unit1._id, order: 1 });
    const topic1_2 = await Topic.create({ name: "Construction Practices", unitId: unit1._id, order: 2 });
    await Subtopic.create([
      { name: "Brick", topicId: topic1_1._id, order: 1 },
      { name: "Stones", topicId: topic1_1._id, order: 2 },
      { name: "Aggregates & M-Sand", topicId: topic1_1._id, order: 3 },
      { name: "Cement", topicId: topic1_1._id, order: 4 },
      { name: "Admixtures", topicId: topic1_1._id, order: 5 },
      { name: "Concrete (Self-compacting concrete)", topicId: topic1_1._id, order: 6 },
      { name: "Mix Design", topicId: topic1_1._id, order: 7 },
      { name: "Timber", topicId: topic1_1._id, order: 8 },
      { name: "Recycled and modern materials", topicId: topic1_1._id, order: 9 }
    ]);
    await Subtopic.create([
      { name: "Masonry", topicId: topic1_2._id, order: 1 },
      { name: "Construction Equipments", topicId: topic1_2._id, order: 2 },
      { name: "Building bye-laws", topicId: topic1_2._id, order: 3 },
      { name: "Fire safety, lighting and ventilation", topicId: topic1_2._id, order: 4 },
      { name: "Acoustics", topicId: topic1_2._id, order: 5 }
    ]);

    // Unit 2
    const unit2 = await Unit.create({ examId, name: "Unit 2: Engineering Survey", order: 2 });
    const topic2_1 = await Topic.create({ name: "Surveying Fundamentals", unitId: unit2._id, order: 1 });
    const topic2_2 = await Topic.create({ name: "Advanced Surveying", unitId: unit2._id, order: 2 });
    await Subtopic.create([
      { name: "Basics of Surveying", topicId: topic2_1._id, order: 1 },
      { name: "Chain Surveying", topicId: topic2_1._id, order: 2 },
      { name: "Compass Surveying", topicId: topic2_1._id, order: 3 },
      { name: "Plane Table Surveying", topicId: topic2_1._id, order: 4 }
    ]);
    await Subtopic.create([
      { name: "Levelling", topicId: topic2_2._id, order: 1 },
      { name: "Computation of area and volume", topicId: topic2_2._id, order: 2 },
      { name: "Contouring", topicId: topic2_2._id, order: 3 },
      { name: "Theodolite surveying", topicId: topic2_2._id, order: 4 },
      { name: "Traversing", topicId: topic2_2._id, order: 5 },
      { name: "Tacheometry", topicId: topic2_2._id, order: 6 },
      { name: "Triangulation", topicId: topic2_2._id, order: 7 },
      { name: "Modern Surveying Techniques", topicId: topic2_2._id, order: 8 }
    ]);

    // Unit 3
    const unit3 = await Unit.create({ examId, name: "Unit 3: Engineering Mechanics & Strength of Materials", order: 3 });
    const topic3_1 = await Topic.create({ name: "Engineering Mechanics", unitId: unit3._id, order: 1 });
    const topic3_2 = await Topic.create({ name: "Strength of Materials", unitId: unit3._id, order: 2 });
    await Subtopic.create([
      { name: "Forces: Types & Laws", topicId: topic3_1._id, order: 1 },
      { name: "CoG & MI", topicId: topic3_1._id, order: 2 },
      { name: "Friction", topicId: topic3_1._id, order: 3 }
    ]);
    await Subtopic.create([
      { name: "Stresses and Strains", topicId: topic3_2._id, order: 1 },
      { name: "Beams: SFD & BMD", topicId: topic3_2._id, order: 2 },
      { name: "Theory of simple bending", topicId: topic3_2._id, order: 3 },
      { name: "Deflection of beams", topicId: topic3_2._id, order: 4 },
      { name: "Torsion", topicId: topic3_2._id, order: 5 },
      { name: "Combined stresses", topicId: topic3_2._id, order: 6 },
      { name: "Stress Transformations & Failure Theories", topicId: topic3_2._id, order: 7 },
      { name: "Analysis of plane trusses", topicId: topic3_2._id, order: 8 }
    ]);

    res.json({ message: 'Curriculum seeded successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

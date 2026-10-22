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
const { sortQuestionsByPattern } = require('../utils/testPattern');

router.use(verifyToken);

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

const MAX_IMAGE_BYTES = 150 * 1024;

function base64ByteLength(value) {
  if (typeof value !== 'string' || !value) return 0;
  const data = value.includes(',') ? value.split(',')[1] : value;
  return Buffer.byteLength(data, 'base64');
}

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

const getStudentExamIds = async (req) => {
  if (!req.user || req.user.role !== 'student') return null;
  const student = await User.findOne({ email: req.user.email }).select('examIds');
  return (student?.examIds || []).map((id) => id.toString());
};

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

router.get('/exams', isAdmin, async (req, res) => {
  try {
    const exams = await Exam.find().sort({ name: 1 });
    res.json(exams);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving exams', error: error.message });
  }
});

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

router.post('/tests', isAdmin, async (req, res) => {
  try {
    const { name, publishToStudent, examId, pattern, durationMinutes } = req.body;
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

    const test = new Test({
      name: name.trim(),
      publishToStudent: !!publishToStudent,
      examId,
      pattern: Array.isArray(pattern) && pattern.length > 0 ? pattern : undefined,
      durationMinutes: durationMinutes || undefined
    });
    await test.save();
    res.status(201).json(test);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating test', error: error.message });
  }
});

const cascadeRenamePatternSections = async (test, oldPattern, newPattern) => {
  if (!Array.isArray(oldPattern) || !Array.isArray(newPattern)) return;

  const oldPartByKey = new Map(oldPattern.map((p) => [p.key, p]));
  const baseFilter = { $or: [{ testId: test._id }, { testName: test.name }] };

  for (const newPart of newPattern) {
    const oldPart = newPart.key && oldPartByKey.get(newPart.key);
    if (!oldPart) continue;

    const oldSectionByKey = new Map((oldPart.sections || []).map((s) => [s.key, s]));
    const handledOldSectionNames = [];

    for (const newSection of newPart.sections || []) {
      const oldSection = newSection.key && oldSectionByKey.get(newSection.key);
      if (!oldSection) continue;
      handledOldSectionNames.push(oldSection.name);
      if (oldSection.name !== newSection.name || oldPart.name !== newPart.name) {
        await ExamQuestion.updateMany(
          { ...baseFilter, part: oldPart.name, section: oldSection.name },
          { $set: { part: newPart.name, section: newSection.name } }
        );
      }
    }

    if (oldPart.name !== newPart.name) {
      await ExamQuestion.updateMany(
        { ...baseFilter, part: oldPart.name, section: { $nin: handledOldSectionNames } },
        { $set: { part: newPart.name } }
      );
    }
  }
};

router.put('/tests/:id', isAdmin, async (req, res) => {
  try {
    const { name, publishToStudent, examId, pattern, durationMinutes } = req.body;
    const existingTest = await Test.findById(req.params.id).select('name pattern');
    if (!existingTest) {
      return res.status(404).json({ message: 'Test not found' });
    }

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
    if (durationMinutes !== undefined) {
      update.durationMinutes = durationMinutes || 180;
    }
    const clearsPattern = pattern !== undefined && (!Array.isArray(pattern) || pattern.length === 0);
    if (pattern !== undefined && !clearsPattern) {
      update.pattern = pattern;
    }

    const test = await Test.findByIdAndUpdate(
      req.params.id,
      clearsPattern ? { ...update, $unset: { pattern: 1 } } : update,
      { new: true, runValidators: true }
    ).populate('examId', 'name');
    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }

    if (pattern !== undefined && !clearsPattern) {
      await cascadeRenamePatternSections(existingTest, existingTest.pattern, pattern);
    }

    res.json(test);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating test', error: error.message });
  }
});

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

router.post('/exam', isAdmin, async (req, res) => {
  try {
    const { testName, testId, part, section } = req.body;
    if (!testName) {
      return res.status(400).json({ message: 'testName is required' });
    }

    const oversizedImageError = findOversizedImage(req.body);
    if (oversizedImageError) {
      return res.status(413).json({ message: oversizedImageError });
    }

    if (part && section) {
      const test = testId ? await Test.findById(testId).select('pattern') : await Test.findOne({ name: testName }).select('pattern');
      const patternSection = test?.pattern?.find((p) => p.name === part)?.sections.find((s) => s.name === section);
      if (patternSection) {
        const existingCount = await ExamQuestion.countDocuments({ testName, part, section });
        if (existingCount >= patternSection.numQuestions) {
          return res.status(400).json({
            message: `"${section}" in "${part}" already has its full ${patternSection.numQuestions} questions. Remove one first or pick a different section.`
          });
        }
      }
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

router.get('/exam', isAdmin, async (req, res) => {
  try {
    const { testId, testName } = req.query;
    if (!testId && !testName) {
      return res.status(400).json({ message: 'testId or testName is required' });
    }

    const query = testId ? { testId } : { testName };
    const [questions, test] = await Promise.all([
      ExamQuestion.find(query).sort({ createdAt: 1 }),
      testId ? Test.findById(testId).select('pattern') : Test.findOne({ name: testName }).select('pattern')
    ]);
    res.json(sortQuestionsByPattern(questions, test?.pattern));
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving exam questions', error: error.message });
  }
});

router.get('/exam/count', isAdmin, async (req, res) => {
  try {
    const { testName, part, section } = req.query;
    if (!testName) {
      return res.status(400).json({ message: 'testName is required' });
    }
    const query = { testName };
    if (part) query.part = part;
    if (section) query.section = section;
    const count = await ExamQuestion.countDocuments(query);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Server error getting question count', error: error.message });
  }
});

router.get('/exam/section-counts', isAdmin, async (req, res) => {
  try {
    const { testName } = req.query;
    if (!testName) {
      return res.status(400).json({ message: 'testName is required' });
    }
    const rows = await ExamQuestion.aggregate([
      { $match: { testName } },
      { $group: { _id: { part: '$part', section: '$section' }, count: { $sum: 1 } } }
    ]);
    res.json(rows.map((row) => ({ part: row._id.part || '', section: row._id.section || '', count: row.count })));
  } catch (error) {
    res.status(500).json({ message: 'Server error getting section counts', error: error.message });
  }
});

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
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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
router.delete('/delete/bulk', isAdmin, async (req, res) => {
  try {
    const { topicId, subtopicId } = req.query;
    let query = {};

    // Never fall through to an empty filter: that would delete every question in the collection.
    if (subtopicId) {
      if (!mongoose.isValidObjectId(subtopicId)) {
        return res.status(400).json({ message: 'Invalid subtopicId' });
      }
      query.subtopicId = subtopicId;
    } else if (topicId) {
      if (!mongoose.isValidObjectId(topicId)) {
        return res.status(400).json({ message: 'Invalid topicId' });
      }
      query.topicId = topicId;
    } else {
      return res.status(400).json({ message: 'A topicId or subtopicId is required' });
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

router.delete('/units/:id', isAdmin, async (req, res) => {
  try {
    const unitId = req.params.id;
    const unit = await Unit.findById(unitId);
    if (!unit) {
      return res.status(404).json({ message: 'Unit not found' });
    }

    const topics = await Topic.find({ unitId });
    const topicIds = topics.map(t => t._id);

    const subtopics = await Subtopic.find({ topicId: { $in: topicIds } });
    const subtopicIds = subtopics.map(st => st._id);

    await Question.deleteMany({
      $or: [
        { unitId },
        { topicId: { $in: topicIds } },
        { subtopicId: { $in: subtopicIds } }
      ]
    });

    await Subtopic.deleteMany({ topicId: { $in: topicIds } });

    await Topic.deleteMany({ unitId });

    await Unit.findByIdAndDelete(unitId);

    res.json({ message: 'Unit and all associated topics, subtopics, and questions deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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

router.delete('/topics/:id', isAdmin, async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await Topic.findById(topicId);
    if (!topic) {
      return res.status(404).json({ message: 'Topic not found' });
    }

    const subtopics = await Subtopic.find({ topicId });
    const subtopicIds = subtopics.map(st => st._id);

    await Question.deleteMany({
      $or: [
        { topicId },
        { subtopicId: { $in: subtopicIds } }
      ]
    });

    await Subtopic.deleteMany({ topicId });

    await Topic.findByIdAndDelete(topicId);

    res.json({ message: 'Topic and all associated subtopics and questions deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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

router.delete('/subtopics/:id', isAdmin, async (req, res) => {
  try {
    const subtopicId = req.params.id;
    const subtopic = await Subtopic.findById(subtopicId);
    if (!subtopic) {
      return res.status(404).json({ message: 'Subtopic not found' });
    }

    await Question.deleteMany({ subtopicId });

    await Subtopic.findByIdAndDelete(subtopicId);

    res.json({ message: 'Subtopic and all associated questions deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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

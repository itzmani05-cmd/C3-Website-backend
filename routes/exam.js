const express = require('express');
const router = express.Router();
const StudentExam = require('../models/StudentExam');
const ExamQuestion = require('../models/ExamQuestion');
const Test = require('../models/Test');
const { verifyToken } = require('./auth');

const EXAM_DURATION_SEC = 180 * 60;

const getRemainingTimeSec = (startedAt) => {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const elapsedSec = Math.floor(elapsedMs / 1000);
  return Math.max(0, EXAM_DURATION_SEC - elapsedSec);
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

const calculateAndSaveResult = async (studentExam) => {
  try {
    const questions = await ExamQuestion.find({
      $or: [
        { testId: studentExam.testId },
        { testName: studentExam.testName }
      ]
    });

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    questions.forEach((q) => {
      const qId = q._id.toString();
      const studentAns = studentExam.answers.get(qId);
      if (!studentAns) {
        unansweredCount++;
      } else if (studentAns.trim().toLowerCase() === q.correct_answer?.trim().toLowerCase()) {
        correctCount++;
      } else {
        wrongCount++;
      }
    });

    studentExam.totalQuestions = questions.length;
    studentExam.correctCount = correctCount;
    studentExam.wrongCount = wrongCount;
    studentExam.unansweredCount = unansweredCount;
    studentExam.score = correctCount;
    studentExam.percentage = questions.length > 0 ? parseFloat(((correctCount / questions.length) * 100).toFixed(2)) : 0;
    studentExam.submitted = true;
    if (!studentExam.submittedAt) {
      studentExam.submittedAt = new Date();
    }
    
    await studentExam.save();
    return studentExam;
  } catch (error) {
    console.error('Error calculating exam results:', error);
    throw error;
  }
};

// ─── GET /api/exam/list ───────────────────────────────────────────────────────
// Returns only tests where publishToStudent === true
router.get('/list', verifyToken, async (req, res) => {
  try {
    const studentEmail = req.user.email;
    const tests = await Test.find({ publishToStudent: true })
      .select('_id name createdAt')
      .sort({ createdAt: 1 });

    const testsWithStatus = await Promise.all(tests.map(async (test) => {
      const attempt = await StudentExam.findOne({ studentEmail, testId: test._id });
      return {
        _id: test._id,
        name: test.name,
        createdAt: test.createdAt,
        submitted: attempt ? attempt.submitted : false,
        score: attempt && attempt.submitted ? attempt.score : null,
        percentage: attempt && attempt.submitted ? attempt.percentage : null,
        totalQuestions: attempt && attempt.submitted ? attempt.totalQuestions : null,
      };
    }));

    res.json(testsWithStatus);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving tests', error: error.message });
  }
});

// ─── POST /api/exam/start ─────────────────────────────────────────────────────
// Accepts { testId } — resolves test name, then fetches questions by testName
router.post('/start', verifyToken, async (req, res) => {
  try {
    const studentEmail = req.user.email;
    const { testId } = req.body;

    if (!testId) {
      return res.status(400).json({ message: 'testId is required' });
    }

    // Resolve the Test document
    const testDoc = await Test.findById(testId);
    if (!testDoc) {
      return res.status(404).json({ message: 'Test not found' });
    }
    if (!testDoc.publishToStudent) {
      return res.status(403).json({ message: 'This test is not available to students' });
    }

    const testName = testDoc.name;

    // Find or create exam session
    let studentExam = await StudentExam.findOne({ studentEmail, testId });

    if (!studentExam) {
      studentExam = new StudentExam({
        studentEmail,
        testId,
        testName,
        startedAt: new Date(),
        answers: {},
        submitted: false
      });
      await studentExam.save();
    }

    let remainingTime = getRemainingTimeSec(studentExam.startedAt);

    if (remainingTime <= 0 && !studentExam.submitted) {
      await calculateAndSaveResult(studentExam);
      remainingTime = 0;
    } else if (studentExam.submitted && (!studentExam.totalQuestions || studentExam.totalQuestions === 0)) {
      await calculateAndSaveResult(studentExam);
    }

    // Fetch questions by testId or testName (backward-compatible with existing data)
    let questions;
    if (studentExam.submitted) {
      questions = await ExamQuestion.find({
        $or: [{ testId: testDoc._id }, { testName: studentExam.testName }]
      });
    } else {
      questions = await ExamQuestion.find({
        $or: [{ testId: testDoc._id }, { testName: studentExam.testName }]
      }).select('-correct_answer -explanation -explanationImage');
    }

    res.json({
      testId: testDoc._id,
      testName: studentExam.testName,
      startedAt: studentExam.startedAt,
      remainingTime: studentExam.submitted ? 0 : remainingTime,
      answers: studentExam.answers || {},
      submitted: studentExam.submitted,
      submittedAt: studentExam.submittedAt,
      score: studentExam.score,
      totalQuestions: studentExam.totalQuestions,
      correctCount: studentExam.correctCount,
      wrongCount: studentExam.wrongCount,
      unansweredCount: studentExam.unansweredCount,
      percentage: studentExam.percentage,
      questions
    });

  } catch (error) {
    console.error('Error starting student exam:', error);
    res.status(500).json({ message: 'Server error starting exam', error: error.message });
  }
});

// ─── POST /api/exam/sync ──────────────────────────────────────────────────────
router.post('/sync', verifyToken, async (req, res) => {
  try {
    const studentEmail = req.user.email;
    const { testId, answers } = req.body;

    if (!testId) {
      return res.status(400).json({ message: 'testId is required' });
    }

    const studentExam = await StudentExam.findOne({ studentEmail, testId });
    if (!studentExam) {
      return res.status(404).json({ message: 'Exam session not found' });
    }

    if (studentExam.submitted) {
      return res.status(400).json({
        message: 'Exam already submitted',
        submitted: true,
        remainingTime: 0
      });
    }

    const remainingTime = getRemainingTimeSec(studentExam.startedAt);
    if (remainingTime <= 0) {
      await calculateAndSaveResult(studentExam);
      return res.status(400).json({
        message: 'Exam time expired, responses auto-submitted',
        submitted: true,
        remainingTime: 0
      });
    }

    if (answers && typeof answers === 'object') {
      for (const [qId, option] of Object.entries(answers)) {
        if (option === null || option === '') {
          studentExam.answers.delete(qId);
        } else {
          studentExam.answers.set(qId, option);
        }
      }
    }

    studentExam.markModified('answers');
    await studentExam.save();

    res.json({
      message: 'Progress synchronized',
      remainingTime,
      submitted: false
    });

  } catch (error) {
    console.error('Error syncing exam:', error);
    res.status(500).json({ message: 'Server error syncing progress', error: error.message });
  }
});

// ─── POST /api/exam/submit ────────────────────────────────────────────────────
router.post('/submit', verifyToken, async (req, res) => {
  try {
    const studentEmail = req.user.email;
    const { testId } = req.body;

    if (!testId) {
      return res.status(400).json({ message: 'testId is required' });
    }

    const studentExam = await StudentExam.findOne({ studentEmail, testId });

    if (!studentExam) {
      return res.status(404).json({ message: 'Exam session not found' });
    }

    if (studentExam.submitted) {
      return res.status(400).json({ message: 'Exam has already been submitted' });
    }

    studentExam.submittedAt = new Date();
    await calculateAndSaveResult(studentExam);

    const questions = await ExamQuestion.find({
      $or: [{ testId: studentExam.testId }, { testName: studentExam.testName }]
    });

    res.json({
      message: 'Exam submitted successfully',
      submittedAt: studentExam.submittedAt,
      score: studentExam.score,
      totalQuestions: studentExam.totalQuestions,
      correctCount: studentExam.correctCount,
      wrongCount: studentExam.wrongCount,
      unansweredCount: studentExam.unansweredCount,
      percentage: studentExam.percentage,
      questions
    });

  } catch (error) {
    console.error('Error submitting exam:', error);
    res.status(500).json({ message: 'Server error submitting exam', error: error.message });
  }
});

// ─── GET /api/exam/admin/results ──────────────────────────────────────────────
router.get('/admin/results', verifyToken, isAdmin, async (req, res) => {
  try {
    const results = await StudentExam.find({ submitted: true })
      .sort({ submittedAt: -1 });
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving results', error: error.message });
  }
});

// ─── GET /api/exam/admin/results/:id ──────────────────────────────────────────
router.get('/admin/results/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const studentExam = await StudentExam.findById(req.params.id);
    if (!studentExam) {
      return res.status(404).json({ message: 'Result not found' });
    }
    const questions = await ExamQuestion.find({
      $or: [
        { testId: studentExam.testId },
        { testName: studentExam.testName }
      ]
    });
    res.json({
      studentExam,
      questions
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving result detail', error: error.message });
  }
});

// ─── DELETE /api/exam/admin/results/:id ───────────────────────────────────────
router.delete('/admin/results/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const studentExam = await StudentExam.findByIdAndDelete(req.params.id);
    if (!studentExam) {
      return res.status(404).json({ message: 'Result not found' });
    }
    res.json({ message: 'Exam result/attempt deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting result', error: error.message });
  }
});

module.exports = router;

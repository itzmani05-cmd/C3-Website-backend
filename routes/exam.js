const express = require('express');
const router = express.Router();
const StudentExam = require('../models/StudentExam');
const ExamQuestion = require('../models/ExamQuestion');
const Test = require('../models/Test');
const User = require('../models/User');
const { verifyToken } = require('./auth');
const { buildNegativeFractionLookup, sortQuestionsByPattern, annotateNegativeMarks } = require('../utils/testPattern');

const attachStudentNames = async (studentExams) => {
  const emails = [...new Set(studentExams.map((r) => r.studentEmail))];
  const users = await User.find({ email: { $in: emails } }).select('email name');
  const nameByEmail = new Map(users.map((u) => [u.email, u.name]));
  return studentExams.map((r) => {
    const obj = r.toObject ? r.toObject() : r;
    return { ...obj, studentName: nameByEmail.get(obj.studentEmail) || '' };
  });
};

const DEFAULT_EXAM_DURATION_MIN = 180;

const getRemainingTimeSec = (startedAt, durationMinutes) => {
  const durationSec = (durationMinutes || DEFAULT_EXAM_DURATION_MIN) * 60;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const elapsedSec = Math.floor(elapsedMs / 1000);
  return Math.max(0, durationSec - elapsedSec);
};

// Multi-select questions aren't answerable through the current single-choice exam UI yet; this
// keeps grading from crashing on their array correct_answer instead of matching them.
const correctAnswerAsString = (value) => (typeof value === 'string' ? value : '');

// Numerical-answer questions are graded by value, not exact text, so "7", "7.0" and "07" all
// match a correct_answer of 7. Falls back to string equality when either side isn't a plain number
// (e.g. a NAT question whose answer is itself non-numeric text).
const isNumericalAnswerCorrect = (studentAns, correctAnswer) => {
  const studentNum = parseFloat(studentAns);
  const correctNum = parseFloat(correctAnswer);
  if (!Number.isNaN(studentNum) && !Number.isNaN(correctNum)) {
    return Math.abs(studentNum - correctNum) < 0.01;
  }
  return studentAns.trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
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

    const testDoc = studentExam.testId ? await Test.findById(studentExam.testId).select('pattern') : null;
    const negativeFractionFor = buildNegativeFractionLookup(testDoc?.pattern);

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    let score = 0;
    let maxScore = 0;

    questions.forEach((q) => {
      const marks = typeof q.marks === 'number' && q.marks > 0 ? q.marks : 1;
      maxScore += marks;

      const qId = q._id.toString();
      const studentAns = studentExam.answers.get(qId);
      if (!studentAns) {
        unansweredCount++;
        return;
      }

      const isCorrect = q.answerType === 'numerical'
        ? isNumericalAnswerCorrect(studentAns, q.correct_answer)
        : studentAns.trim().toLowerCase() === correctAnswerAsString(q.correct_answer).trim().toLowerCase();
      if (isCorrect) {
        correctCount++;
        score += marks;
      } else {
        wrongCount++;
        // GATE-style negative marking only ever applies to single-choice (MCQ) questions —
        // multi-select and numerical-answer questions are never penalized for a wrong attempt.
        if (q.answerType === 'single') {
          score -= marks * negativeFractionFor(q);
        }
      }
    });

    studentExam.totalQuestions = questions.length;
    studentExam.correctCount = correctCount;
    studentExam.wrongCount = wrongCount;
    studentExam.unansweredCount = unansweredCount;
    studentExam.score = parseFloat(score.toFixed(2));
    studentExam.maxScore = maxScore;
    studentExam.percentage = maxScore > 0 ? parseFloat(((score / maxScore) * 100).toFixed(2)) : 0;
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
    const student = await User.findOne({ email: studentEmail }).select('examIds');
    const examIds = student?.examIds || [];

    const testQuery = { publishToStudent: true, examId: { $in: examIds } };
    const tests = await Test.find(testQuery)
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
        maxScore: attempt && attempt.submitted ? attempt.maxScore : null,
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

    const student = await User.findOne({ email: studentEmail }).select('examIds');
    const isEnrolled = (student?.examIds || []).some((id) => id.toString() === testDoc.examId.toString());
    if (!isEnrolled) {
      return res.status(403).json({ message: 'This test is not available for your enrolled exam' });
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

    let remainingTime = getRemainingTimeSec(studentExam.startedAt, testDoc.durationMinutes);

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
    questions = annotateNegativeMarks(sortQuestionsByPattern(questions, testDoc.pattern), testDoc.pattern);

    res.json({
      testId: testDoc._id,
      testName: studentExam.testName,
      startedAt: studentExam.startedAt,
      remainingTime: studentExam.submitted ? 0 : remainingTime,
      answers: studentExam.answers || {},
      submitted: studentExam.submitted,
      submittedAt: studentExam.submittedAt,
      score: studentExam.score,
      maxScore: studentExam.maxScore,
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

    const testDoc = await Test.findById(testId).select('durationMinutes');
    const remainingTime = getRemainingTimeSec(studentExam.startedAt, testDoc?.durationMinutes);
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

    const [questionsRaw, testDoc] = await Promise.all([
      ExamQuestion.find({ $or: [{ testId: studentExam.testId }, { testName: studentExam.testName }] }),
      studentExam.testId ? Test.findById(studentExam.testId).select('pattern') : null
    ]);
    const questions = annotateNegativeMarks(sortQuestionsByPattern(questionsRaw, testDoc?.pattern), testDoc?.pattern);

    res.json({
      message: 'Exam submitted successfully',
      submittedAt: studentExam.submittedAt,
      score: studentExam.score,
      maxScore: studentExam.maxScore,
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

// ─── GET /api/exam/admin/tests-summary ────────────────────────────────────────
// One row per test that has at least one submitted attempt, with aggregate
// stats for the admin Results landing page (master view).
router.get('/admin/tests-summary', verifyToken, isAdmin, async (req, res) => {
  try {
    const summary = await StudentExam.aggregate([
      { $match: { submitted: true } },
      {
        $group: {
          _id: { testId: '$testId', testName: '$testName' },
          studentsAttempted: { $sum: 1 },
          lastSubmittedAt: { $max: '$submittedAt' },
          averagePercentage: { $avg: '$percentage' }
        }
      },
      { $sort: { lastSubmittedAt: -1 } }
    ]);

    res.json(summary.map((row) => ({
      testId: row._id.testId || null,
      testName: row._id.testName,
      studentsAttempted: row.studentsAttempted,
      lastSubmittedAt: row.lastSubmittedAt,
      averagePercentage: typeof row.averagePercentage === 'number' ? parseFloat(row.averagePercentage.toFixed(2)) : 0
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving test summary', error: error.message });
  }
});

// ─── GET /api/exam/admin/results ──────────────────────────────────────────────
// Optionally filter to a single test via ?testId= or ?testName= (detail view).
router.get('/admin/results', verifyToken, isAdmin, async (req, res) => {
  try {
    const { testId, testName } = req.query;
    const query = { submitted: true };
    if (testId) {
      query.testId = testId;
    } else if (testName) {
      query.testName = testName;
    }

    const results = await StudentExam.find(query).sort({ submittedAt: -1 });
    res.json(await attachStudentNames(results));
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
    const [questionsRaw, testDoc] = await Promise.all([
      ExamQuestion.find({ $or: [{ testId: studentExam.testId }, { testName: studentExam.testName }] }),
      studentExam.testId ? Test.findById(studentExam.testId).select('pattern') : null
    ]);
    const questions = sortQuestionsByPattern(questionsRaw, testDoc?.pattern);
    const [studentExamWithName] = await attachStudentNames([studentExam]);
    res.json({
      studentExam: studentExamWithName,
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

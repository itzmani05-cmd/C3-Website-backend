const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const DailyChallenge = require('../models/DailyChallenge');
const DailyChallengeAttempt = require('../models/DailyChallengeAttempt');
const Question = require('../models/Question');
const Exam = require('../models/Exam');
const User = require('../models/User');
const { verifyToken } = require('./auth');

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

const OPTION_KEYS = ['a', 'b', 'c', 'd'];

const computeDateKey = (date) => new Date(date).toISOString().slice(0, 10);

// ─── Publish-readiness validation ──────────────────────────────────────────
const isQuestionPublishReady = (q) => {
  if (!q || !q.question || !q.question.trim()) return false;
  if (!q.explanation || !q.explanation.trim()) return false;

  const answerType = q.answerType || 'single';
  if (answerType === 'numerical') {
    return q.correct_answer !== undefined && q.correct_answer !== null && String(q.correct_answer).trim() !== '';
  }

  const opts = q.options || {};
  const hasAllOptions = OPTION_KEYS.every((k) => opts[k] && String(opts[k]).trim());
  if (!hasAllOptions) return false;

  if (answerType === 'multiple') {
    return Array.isArray(q.correct_answer) && q.correct_answer.length > 0;
  }
  return typeof q.correct_answer === 'string' && OPTION_KEYS.includes(q.correct_answer);
};

// The C3App mobile client's Daily Challenge UI renders single-choice, multiple-choice (checkbox),
// and numerical (free-text) questions — mirrors regular publish-readiness exactly.
const isSingleChoiceReady = (q) => isQuestionPublishReady(q);

const getCorrectOptionIndexes = (q) => {
  if (!Array.isArray(q.correct_answer)) return [];
  return q.correct_answer
    .map((key) => OPTION_KEYS.indexOf(String(key || '').trim().toLowerCase()))
    .filter((idx) => idx >= 0);
};

// Builds the frozen snapshot the mobile client reads instead of resolving questionIds live, so a
// later edit to a Question doesn't retroactively change a challenge students are already attempting.
// Assumes every question has already passed isSingleChoiceReady.
const buildQuestionSnapshot = (questions) =>
  questions.map((q, index) => {
    const answerType = q.answerType || 'single';
    return {
      questionId: q._id,
      order: index,
      questionText: q.question || '',
      questionImage: q.questionImage || '',
      options: OPTION_KEYS.map((k) => q.options?.[k] || ''),
      optionImages: OPTION_KEYS.map((k) => q.optionImages?.[k] || ''),
      answerType,
      correctOptionIndex: OPTION_KEYS.indexOf(q.correct_answer),
      correctOptionIndexes: answerType === 'multiple' ? getCorrectOptionIndexes(q) : [],
      numericalAnswer: answerType === 'numerical' ? String(q.correct_answer ?? '').trim() : '',
      explanation: q.explanation || '',
      explanationImage: q.explanationImage || '',
      topicId: q.topicId || null,
      subtopicId: q.subtopicId || null,
    };
  });

// ─── Grading (single/multiple/numerical aware, mirrors Question.answerType) ─
const isAnswerCorrect = (question, submitted) => {
  if (submitted === undefined || submitted === null || submitted === '') return false;
  const answerType = question.answerType || 'single';

  if (answerType === 'multiple') {
    const correct = Array.isArray(question.correct_answer) ? question.correct_answer : [];
    let submittedArr = submitted;
    if (!Array.isArray(submittedArr)) {
      try {
        submittedArr = JSON.parse(submitted);
      } catch (e) {
        submittedArr = String(submitted).split(',');
      }
    }
    if (!Array.isArray(submittedArr)) return false;
    const normalize = (arr) => arr.map((v) => String(v).trim().toLowerCase()).filter(Boolean).sort();
    const a = normalize(correct);
    const b = normalize(submittedArr);
    return a.length > 0 && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  if (answerType === 'numerical') {
    const correct = String(question.correct_answer ?? '').trim();
    const sub = String(submitted).trim();
    if (!correct || !sub) return false;
    const correctNum = Number(correct);
    const subNum = Number(sub);
    if (!Number.isNaN(correctNum) && !Number.isNaN(subNum)) return correctNum === subNum;
    return correct.toLowerCase() === sub.toLowerCase();
  }

  const correct = typeof question.correct_answer === 'string' ? question.correct_answer : '';
  return correct.trim().toLowerCase() === String(submitted).trim().toLowerCase();
};

const answerValueToStore = (value) => (Array.isArray(value) ? JSON.stringify(value) : String(value ?? ''));

const stripAnswerFields = (q) => {
  const obj = q.toObject ? q.toObject() : q;
  const { correct_answer, explanation, explanationImage, ...safe } = obj;
  return safe;
};

const attachStudentNames = async (rows, emailKey = 'studentEmail') => {
  const emails = [...new Set(rows.map((r) => r[emailKey]))];
  const users = await User.find({ email: { $in: emails } }).select('email name');
  const nameByEmail = new Map(users.map((u) => [u.email, u.name]));
  return rows.map((r) => ({ ...r, studentName: nameByEmail.get(r[emailKey]) || '' }));
};

// ════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════════════════════════════════════

// Dashboard: today's challenge, upcoming (scheduled/draft), recent (published/expired)
router.get('/dashboard', verifyToken, isAdmin, async (req, res) => {
  try {
    const { examId } = req.query;
    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }
    const examFilter = { examId };

    const now = new Date();
    const todayKey = computeDateKey(now);

    const today = await DailyChallenge.findOne({ ...examFilter, dateKey: todayKey }).sort({ createdAt: -1 });
    const upcoming = await DailyChallenge.find({
      ...examFilter,
      status: { $in: ['scheduled', 'draft'] },
      startAt: { $gt: now }
    }).sort({ startAt: 1 }).limit(10);
    const recent = await DailyChallenge.find({
      ...examFilter,
      status: { $in: ['published', 'expired'] },
      dateKey: { $ne: todayKey }
    }).sort({ startAt: -1 }).limit(10);

    const draftCount = await DailyChallenge.countDocuments({ ...examFilter, status: 'draft' });
    const totalPublished = await DailyChallenge.countDocuments({ ...examFilter, status: { $in: ['published', 'expired'] } });
    const challengeIdsForExam = await DailyChallenge.find(examFilter).select('_id');
    const totalParticipantsAllTime = (await DailyChallengeAttempt.distinct('studentEmail', {
      challengeId: { $in: challengeIdsForExam.map((c) => c._id) }
    })).length;

    let todayStats = null;
    if (today) {
      const attempts = await DailyChallengeAttempt.find({ challengeId: today._id });
      const startedStudents = new Set(attempts.map((a) => a.studentEmail)).size;
      const completedAttempts = attempts.filter((a) => a.submitted);
      const completedStudents = new Set(completedAttempts.map((a) => a.studentEmail)).size;
      const avgScore = completedAttempts.length
        ? completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / completedAttempts.length
        : 0;
      todayStats = {
        studentsStarted: startedStudents,
        studentsCompleted: completedStudents,
        averageScore: Math.round(avgScore * 100) / 100
      };
    }

    res.json({
      today,
      todayStats,
      upcoming,
      recent,
      draftCount,
      stats: { totalPublished, totalParticipantsAllTime }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error loading dashboard', error: error.message });
  }
});

// List all (optionally filtered by status and/or exam)
router.get('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { status, examId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (examId) query.examId = examId;
    const challenges = await DailyChallenge.find(query).sort({ startAt: -1 });
    res.json(challenges);
  } catch (error) {
    res.status(500).json({ message: 'Server error listing challenges', error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
// STUDENT-FACING: currently active challenge, answers/explanations stripped
// Registered before '/:id' so the literal path 'active' isn't swallowed by it.
// ════════════════════════════════════════════════════════════════════════
router.get('/active', verifyToken, async (req, res) => {
  try {
    const student = await User.findOne({ email: req.user.email }).select('examIds');
    const examIds = student?.examIds || [];

    const now = new Date();
    const challenge = await DailyChallenge.findOne({
      status: 'published',
      examId: { $in: examIds },
      startAt: { $lte: now },
      expiresAt: { $gt: now }
    }).sort({ startAt: -1 }).populate('questionIds');

    if (!challenge) {
      return res.status(404).json({ message: 'No active Daily Challenge right now' });
    }

    const attemptsUsed = await DailyChallengeAttempt.countDocuments({
      challengeId: challenge._id,
      studentEmail: req.user.email
    });

    res.json({
      _id: challenge._id,
      title: challenge.title,
      description: challenge.description,
      questionCount: challenge.questionCount,
      maxAttempts: challenge.maxAttempts,
      startAt: challenge.startAt,
      expiresAt: challenge.expiresAt,
      questions: (challenge.questionIds || []).map(stripAnswerFields),
      attemptsUsed,
      attemptsRemaining: Math.max(0, challenge.maxAttempts - attemptsUsed),
      canAttempt: attemptsUsed < challenge.maxAttempts
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving active challenge', error: error.message });
  }
});

// Analytics for one challenge
router.get('/:id/analytics', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }

    const attempts = await DailyChallengeAttempt.find({ challengeId: challenge._id });
    const eligibleStudents = await User.countDocuments({
      role: { $in: ['Student', 'student'] },
      $or: [{ status: 'active' }, { status: { $exists: false } }]
    });

    const attemptedEmails = new Set(attempts.map((a) => a.studentEmail));
    const submittedAttempts = attempts.filter((a) => a.submitted);
    const submittedEmails = new Set(submittedAttempts.map((a) => a.studentEmail));
    const averagePercentage = submittedAttempts.length
      ? submittedAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / submittedAttempts.length
      : 0;

    const participation = {
      eligibleStudents,
      attemptedStudents: attemptedEmails.size,
      completedStudents: submittedEmails.size,
      notAttempted: Math.max(0, eligibleStudents - attemptedEmails.size),
      participationRate: eligibleStudents ? Math.round((attemptedEmails.size / eligibleStudents) * 10000) / 100 : 0,
      completionRate: eligibleStudents ? Math.round((submittedEmails.size / eligibleStudents) * 10000) / 100 : 0,
      totalAttempts: attempts.length,
      submittedAttempts: submittedAttempts.length,
      averagePercentage: Math.round(averagePercentage * 100) / 100,
      averageAttempts: attemptedEmails.size ? Math.round((attempts.length / attemptedEmails.size) * 100) / 100 : 0
    };

    const byStudent = new Map();
    attempts.forEach((a) => {
      const key = a.studentEmail;
      const entry = byStudent.get(key) || { studentEmail: key, attemptsUsed: 0, bestScore: 0, bestPercentage: 0, submitted: false, lastAttemptAt: null };
      entry.attemptsUsed += 1;
      if (a.submitted) {
        entry.submitted = true;
        if ((a.score || 0) > entry.bestScore) entry.bestScore = a.score || 0;
        if ((a.percentage || 0) > entry.bestPercentage) entry.bestPercentage = a.percentage || 0;
      }
      const attemptTime = a.submittedAt || a.startedAt;
      if (!entry.lastAttemptAt || new Date(attemptTime) > new Date(entry.lastAttemptAt)) {
        entry.lastAttemptAt = attemptTime;
      }
      byStudent.set(key, entry);
    });

    const perStudent = await attachStudentNames([...byStudent.values()]);

    res.json({
      challenge: {
        _id: challenge._id,
        title: challenge.title,
        startAt: challenge.startAt,
        expiresAt: challenge.expiresAt,
        status: challenge.status
      },
      participation,
      perStudent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error loading analytics', error: error.message });
  }
});

// Detail (admin) — full questions populated
router.get('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id).populate('questionIds');
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }
    const obj = challenge.toObject();
    obj.questions = obj.questionIds;
    obj.questionIds = obj.questionIds.map((q) => q._id);
    res.json(obj);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving challenge', error: error.message });
  }
});

// Create draft
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { title, description, questionIds, maxAttempts, availabilityDays, startAt, examId } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }
    if (!examId) {
      return res.status(400).json({ message: 'examId is required' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(400).json({ message: 'Exam not found' });
    }
    if (!startAt) {
      return res.status(400).json({ message: 'startAt is required' });
    }
    if (questionIds && questionIds.length > 5) {
      return res.status(400).json({ message: 'A Daily Challenge cannot have more than 5 questions' });
    }

    const challenge = new DailyChallenge({
      examId,
      title: title.trim(),
      description: description || '',
      questionIds: questionIds || [],
      maxAttempts: maxAttempts || 3,
      availabilityDays: availabilityDays || 3,
      startAt: new Date(startAt),
      dateKey: computeDateKey(startAt),
      status: 'draft',
      createdByEmail: req.user.email
    });
    await challenge.save();
    res.status(201).json(challenge);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating challenge', error: error.message });
  }
});

// Publish (or schedule, if startAt is in the future)
router.post('/:id/publish', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id).populate('questionIds');
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }
    if (challenge.status === 'published' || challenge.status === 'expired') {
      return res.status(409).json({ message: 'This challenge has already been published' });
    }

    if ((challenge.questionIds || []).length !== 5) {
      return res.status(400).json({ message: 'Exactly 5 questions must be selected before publishing' });
    }
    const invalid = challenge.questionIds.find((q) => !isSingleChoiceReady(q));
    if (invalid) {
      return res.status(400).json({
        message: `Question "${(invalid.question || '').slice(0, 60)}" is missing required fields (options, correct answer, or explanation)`
      });
    }

    const conflict = await DailyChallenge.findOne({
      _id: { $ne: challenge._id },
      examId: challenge.examId,
      dateKey: challenge.dateKey,
      status: { $in: ['scheduled', 'published'] }
    });
    if (conflict) {
      return res.status(409).json({ message: `A challenge is already scheduled/published for ${challenge.dateKey} for this exam` });
    }

    const now = new Date();
    const expiresAt = new Date(challenge.startAt.getTime() + challenge.availabilityDays * 24 * 60 * 60 * 1000);
    const willPublishNow = challenge.startAt <= now;

    challenge.expiresAt = expiresAt;
    challenge.status = willPublishNow ? 'published' : 'scheduled';
    challenge.questionSnapshot = buildQuestionSnapshot(challenge.questionIds);
    if (willPublishNow) {
      challenge.publishedAt = now;
      challenge.notifiedAt = now;
    }
    await challenge.save();

    res.json(challenge);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A challenge is already scheduled/published for this date' });
    }
    res.status(500).json({ message: 'Server error publishing challenge', error: error.message });
  }
});

// Duplicate an existing challenge into a new draft
router.post('/:id/duplicate', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const source = await DailyChallenge.findById(req.params.id);
    if (!source) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }
    const { startAt } = req.body;
    if (!startAt) {
      return res.status(400).json({ message: 'startAt is required for the new challenge' });
    }

    const duplicate = new DailyChallenge({
      examId: source.examId,
      title: source.title,
      description: source.description,
      questionIds: source.questionIds,
      maxAttempts: source.maxAttempts,
      availabilityDays: source.availabilityDays,
      startAt: new Date(startAt),
      dateKey: computeDateKey(startAt),
      status: 'draft',
      createdByEmail: req.user.email
    });
    await duplicate.save();
    res.status(201).json(duplicate);
  } catch (error) {
    res.status(500).json({ message: 'Server error duplicating challenge', error: error.message });
  }
});

// Update (blocked once published with existing attempts)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }

    if (challenge.status === 'published' || challenge.status === 'expired') {
      const hasAttempts = await DailyChallengeAttempt.exists({ challengeId: challenge._id });
      if (hasAttempts) {
        return res.status(403).json({
          message: 'This challenge has already been published and students may have attempted it. Changing questions can affect existing results. Duplicate it as a new challenge instead.'
        });
      }
    }

    const { title, description, questionIds, maxAttempts, availabilityDays, startAt, examId } = req.body;
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ message: 'Title cannot be empty' });
      challenge.title = title.trim();
    }
    if (examId !== undefined) {
      const exam = await Exam.findById(examId);
      if (!exam) return res.status(400).json({ message: 'Exam not found' });
      challenge.examId = examId;
    }
    if (description !== undefined) challenge.description = description;
    if (questionIds !== undefined) {
      if (questionIds.length > 5) return res.status(400).json({ message: 'A Daily Challenge cannot have more than 5 questions' });
      challenge.questionIds = questionIds;
    }
    if (maxAttempts !== undefined) challenge.maxAttempts = maxAttempts;
    if (availabilityDays !== undefined) challenge.availabilityDays = availabilityDays;
    if (startAt !== undefined) {
      challenge.startAt = new Date(startAt);
      challenge.dateKey = computeDateKey(startAt);
    }

    await challenge.save();
    res.json(challenge);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A challenge is already scheduled/published for this date' });
    }
    res.status(500).json({ message: 'Server error updating challenge', error: error.message });
  }
});

// Delete (draft only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id);
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }
    if (challenge.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft challenges can be deleted' });
    }
    await DailyChallenge.findByIdAndDelete(req.params.id);
    res.json({ message: 'Daily Challenge deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting challenge', error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
// STUDENT-FACING ENDPOINTS (ready for the mobile app; verifyToken only)
// ════════════════════════════════════════════════════════════════════════

// Own attempt history for a challenge
router.get('/:id/attempts/mine', verifyToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const attempts = await DailyChallengeAttempt.find({
      challengeId: req.params.id,
      studentEmail: req.user.email
    }).sort({ attemptNumber: 1 });
    res.json(attempts);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving attempts', error: error.message });
  }
});

// Start (or resume) an attempt
router.post('/:id/attempts/start', verifyToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid challenge id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id).populate('questionIds');
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }

    const now = new Date();
    if (challenge.status !== 'published' || challenge.startAt > now || challenge.expiresAt <= now) {
      return res.status(403).json({ message: 'This Daily Challenge is not currently available' });
    }

    const existingInProgress = await DailyChallengeAttempt.findOne({
      challengeId: challenge._id,
      studentEmail: req.user.email,
      submitted: false
    });
    if (existingInProgress) {
      return res.json({
        attemptId: existingInProgress._id,
        attemptNumber: existingInProgress.attemptNumber,
        startedAt: existingInProgress.startedAt,
        questions: (challenge.questionIds || []).map(stripAnswerFields)
      });
    }

    const attemptCount = await DailyChallengeAttempt.countDocuments({
      challengeId: challenge._id,
      studentEmail: req.user.email
    });
    if (attemptCount >= challenge.maxAttempts) {
      return res.status(403).json({ message: 'Maximum attempts reached for this Daily Challenge' });
    }

    const attempt = new DailyChallengeAttempt({
      challengeId: challenge._id,
      studentEmail: req.user.email,
      attemptNumber: attemptCount + 1,
      totalQuestions: challenge.questionIds.length
    });
    await attempt.save();

    res.status(201).json({
      attemptId: attempt._id,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      questions: (challenge.questionIds || []).map(stripAnswerFields)
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'An attempt is already in progress' });
    }
    res.status(500).json({ message: 'Server error starting attempt', error: error.message });
  }
});

// Submit an attempt
router.post('/:id/attempts/:attemptId/submit', verifyToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.attemptId)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const challenge = await DailyChallenge.findById(req.params.id).populate('questionIds');
    if (!challenge) {
      return res.status(404).json({ message: 'Daily Challenge not found' });
    }
    const attempt = await DailyChallengeAttempt.findById(req.params.attemptId);
    if (!attempt || attempt.challengeId.toString() !== challenge._id.toString()) {
      return res.status(404).json({ message: 'Attempt not found' });
    }
    if (attempt.studentEmail !== req.user.email) {
      return res.status(403).json({ message: 'You cannot submit another student\'s attempt' });
    }
    if (attempt.submitted) {
      return res.status(400).json({ message: 'This attempt has already been submitted' });
    }
    if (new Date() > challenge.expiresAt) {
      return res.status(400).json({ message: 'This Daily Challenge has expired' });
    }

    const { answers } = req.body;
    const answerMap = answers && typeof answers === 'object' ? answers : {};

    let correctCount = 0;
    (challenge.questionIds || []).forEach((q) => {
      const submittedValue = answerMap[q._id.toString()];
      if (submittedValue !== undefined) {
        attempt.answers.set(q._id.toString(), answerValueToStore(submittedValue));
      }
      if (isAnswerCorrect(q, submittedValue)) correctCount += 1;
    });

    const totalQuestions = challenge.questionIds.length;
    attempt.correctCount = correctCount;
    attempt.score = correctCount;
    attempt.totalQuestions = totalQuestions;
    attempt.percentage = totalQuestions ? Math.round((correctCount / totalQuestions) * 10000) / 100 : 0;
    attempt.submitted = true;
    attempt.submittedAt = new Date();
    await attempt.save();

    res.json({
      score: attempt.score,
      totalQuestions: attempt.totalQuestions,
      correctCount: attempt.correctCount,
      percentage: attempt.percentage,
      submittedAt: attempt.submittedAt,
      questions: challenge.questionIds
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error submitting attempt', error: error.message });
  }
});

module.exports = router;

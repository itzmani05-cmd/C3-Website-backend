const mongoose = require('mongoose');

const studentExamSchema = new mongoose.Schema({
  studentEmail: {
    type: String,
    required: true
  },
  testId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Test'
  },
  testName: {
    type: String,
    required: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  answers: {
    type: Map,
    of: String,
    default: {}
  },
  submitted: {
    type: Boolean,
    default: false
  },
  submittedAt: {
    type: Date
  },
  score: {
    type: Number,
    default: 0
  },
  // Sum of marks across all questions in the test (e.g. 100 for a GATE-pattern paper). Equals
  // totalQuestions for plain, non-patterned tests where every question is worth 1 mark.
  maxScore: {
    type: Number,
    default: 0
  },
  totalQuestions: {
    type: Number,
    default: 0
  },
  correctCount: {
    type: Number,
    default: 0
  },
  wrongCount: {
    type: Number,
    default: 0
  },
  unansweredCount: {
    type: Number,
    default: 0
  },
  percentage: {
    type: Number,
    default: 0
  }
});

studentExamSchema.index({ studentEmail: 1, testName: 1 }, { unique: true });
studentExamSchema.index({ studentEmail: 1, testId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('StudentExam', studentExamSchema);

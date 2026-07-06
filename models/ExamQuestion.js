const mongoose = require('mongoose');

const examQuestionSchema = new mongoose.Schema({
  testId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Test'
  },
  testName: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'Theory-based MCQ'
  },
  question: {
    type: String,
    required: true
  },
  questionImage: {
    type: String,
    default: null
  },
  options: {
    a: { type: String, required: true },
    b: { type: String, required: true },
    c: { type: String, required: true },
    d: { type: String, required: true }
  },
  optionImages: {
    a: { type: String, default: null },
    b: { type: String, default: null },
    c: { type: String, default: null },
    d: { type: String, default: null }
  },
  correct_answer: {
    type: String,
    enum: ['a', 'b', 'c', 'd']
  },
  explanation: {
    type: String,
    default: ''
  },
  explanationImage: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ExamQuestion', examQuestionSchema, 'ExamQuestions');

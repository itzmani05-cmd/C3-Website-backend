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
  // Which part/section of the test's pattern this question belongs to (e.g. "Part A - General
  // Aptitude" / "2 Mark Questions"). Empty for plain (non-patterned) tests.
  part: {
    type: String,
    default: ''
  },
  section: {
    type: String,
    default: ''
  },
  marks: {
    type: Number,
    default: 1,
    min: 0
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
  answerType: {
    type: String,
    enum: ['single', 'multiple', 'numerical'],
    default: 'single'
  },
  options: {
    a: { type: String, default: '' },
    b: { type: String, default: '' },
    c: { type: String, default: '' },
    d: { type: String, default: '' }
  },
  optionImages: {
    a: { type: String, default: null },
    b: { type: String, default: null },
    c: { type: String, default: null },
    d: { type: String, default: null }
  },
  correct_answer: {
    type: mongoose.Schema.Types.Mixed,
    validate: {
      validator: function (value) {
        if (value === undefined || value === null) return true;
        if (this.answerType === 'multiple') {
          return Array.isArray(value) && value.every((v) => ['a', 'b', 'c', 'd'].includes(v));
        }
        if (this.answerType === 'numerical') {
          return typeof value === 'string' || typeof value === 'number';
        }
        return ['a', 'b', 'c', 'd'].includes(value);
      },
      message: 'correct_answer does not match the question\'s answerType'
    }
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

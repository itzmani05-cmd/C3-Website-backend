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
  },
  // Set when this question was copied into the test from the Question Bank, to show where else it was used.
  bankQuestionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionBankQuestion',
    default: null
  }
}, {
  timestamps: true
});

examQuestionSchema.index({ testId: 1, createdAt: 1 });
examQuestionSchema.index({ testName: 1, part: 1, section: 1 });
examQuestionSchema.index({ bankQuestionId: 1 }, { sparse: true });

module.exports = mongoose.model('ExamQuestion', examQuestionSchema, 'ExamQuestions');

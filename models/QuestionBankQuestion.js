const mongoose = require('mongoose');

const optionKeys = ['a', 'b', 'c', 'd'];

const questionBankSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    default: null
  },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
    required: true
  },
  type: {
    type: String,
    default: 'Theory-based MCQ'
  },
  answerType: {
    type: String,
    enum: ['single', 'multiple', 'numerical'],
    default: 'single'
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
    required: true,
    validate: {
      validator: function (value) {
        if (this.answerType === 'multiple') {
          return Array.isArray(value) && value.length > 0 && value.every((v) => optionKeys.includes(v));
        }
        if (this.answerType === 'numerical') {
          return (typeof value === 'string' && value.trim() !== '') || typeof value === 'number';
        }
        return optionKeys.includes(value);
      },
      message: "correct_answer does not match the question's answerType"
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

questionBankSchema.index({ topicId: 1, createdAt: 1 });
questionBankSchema.index({ unitId: 1 });

module.exports = mongoose.model('QuestionBankQuestion', questionBankSchema, 'QuestionBank');

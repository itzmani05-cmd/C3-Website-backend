const mongoose = require('mongoose');

const dailyQuestionSchema = new mongoose.Schema({
  date: {
    // Stored as 'YYYY-MM-DD' so questions can be grouped/counted per day without timezone drift.
    type: String,
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
          return Array.isArray(value) && value.length > 0 && value.every((v) => ['a', 'b', 'c', 'd'].includes(v));
        }
        if (this.answerType === 'numerical') {
          return (typeof value === 'string' && value.trim() !== '') || typeof value === 'number';
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

module.exports = mongoose.model('DailyQuestion', dailyQuestionSchema, 'DailyQuestions');

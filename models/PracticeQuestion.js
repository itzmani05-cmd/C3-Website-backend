const mongoose = require('mongoose');

const optionKeys = ['a', 'b', 'c', 'd'];

const practiceQuestionSchema = new mongoose.Schema({
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
  },
  year: {
    type: Number,
    default: null
  },
  source: {
    type: String,
    default: ''
  },
  marks: {
    type: Number,
    default: null
  },
  // Numerical answers can be accepted over a range (GATE publishes e.g. 89 to 91); correct_answer holds the midpoint.
  answerMin: {
    type: Number,
    default: null
  },
  answerMax: {
    type: Number,
    default: null
  },
  // Admin review tracking
  verified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: String,
    default: ''
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  updatedBy: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Matches the list query (filter topic, sort by createdAt then _id for stable pages) so it is served from the index.
practiceQuestionSchema.index({ topicId: 1, createdAt: 1, _id: 1 });
practiceQuestionSchema.index({ unitId: 1 });

module.exports = mongoose.model('PracticeQuestion', practiceQuestionSchema, 'PracticeQuestion');

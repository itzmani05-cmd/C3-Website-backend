const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
    default: null
  },
  subtopicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subtopic',
    default: null,
  },
  type: {
    type: String,
    enum: ['Theory-based MCQ', 'Numerical/Problem-based', 'Assertion-Reason',
           'Match the Following', 'Statement type (True/False)', 'Diagram-based'],
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
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  is_published: {
    type: Boolean,
    default: false
  },
  // Set when this question is a copy made from the Question Bank (for a Daily Challenge), to show where else it was used.
  bankQuestionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionBankQuestion',
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

questionSchema.index({ unitId: 1, topicId: 1, subtopicId: 1 });
questionSchema.index({ topicId: 1, subtopicId: 1 });
questionSchema.index({ subtopicId: 1 });
questionSchema.index({ bankQuestionId: 1 }, { sparse: true });

module.exports = mongoose.model('Question', questionSchema);

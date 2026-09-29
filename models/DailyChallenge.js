const mongoose = require('mongoose');

const dailyChallengeSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  dateKey: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  questionIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    default: [],
    validate: {
      validator: function (arr) {
        return arr.length <= 5;
      },
      message: 'A Daily Challenge cannot have more than 5 questions'
    }
  },
  questionCount: {
    type: Number,
    default: 5
  },
  questionSnapshot: {
    type: [
      {
        _id: false,
        questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
        order: Number,
        questionText: String,
        questionImage: String,
        options: [String],
        optionImages: [String],
        answerType: { type: String, default: 'single' },
        correctOptionIndex: Number,
        correctOptionIndexes: [Number],
        numericalAnswer: String,
        explanation: String,
        explanationImage: String,
        topicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null },
        subtopicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subtopic', default: null },
      },
    ],
    default: [],
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  availabilityDays: {
    type: Number,
    default: 3
  },
  startAt: {
    type: Date,
    required: true
  },
  expiresAt: {
    type: Date,
    default: null
  },
  publishedAt: {
    type: Date,
    default: null
  },
  notifiedAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'published', 'expired'],
    default: 'draft'
  },
  createdByEmail: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

dailyChallengeSchema.index(
  { examId: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['scheduled', 'published'] } } }
);

module.exports = mongoose.model('DailyChallenge', dailyChallengeSchema);

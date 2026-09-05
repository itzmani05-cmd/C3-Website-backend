const mongoose = require('mongoose');

const dailyChallengeSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  dateKey: {
    // 'YYYY-MM-DD' derived from startAt, used to keep at most one live challenge per day per exam
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
  // Frozen at publish time so later edits to a Question don't retroactively change a challenge
  // students are already attempting (or have completed) — the C3App mobile client reads this
  // instead of resolving questionIds live. Shape mirrors what the mobile client's snapshot
  // renderer expects: single/multiple/numerical, matching Question.answerType.
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

// Only one scheduled/published challenge may occupy a given day per exam; draft duplicates are fine.
dailyChallengeSchema.index(
  { examId: 1, dateKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['scheduled', 'published'] } } }
);

module.exports = mongoose.model('DailyChallenge', dailyChallengeSchema);

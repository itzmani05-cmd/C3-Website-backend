const mongoose = require('mongoose');

const dailyChallengeAttemptSchema = new mongoose.Schema({
  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DailyChallenge',
    required: true
  },
  studentEmail: {
    type: String,
    required: true
  },
  attemptNumber: {
    type: Number,
    required: true
  },
  answers: {
    type: Map,
    of: String,
    default: {}
  },
  score: {
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
  percentage: {
    type: Number,
    default: 0
  },
  submitted: {
    type: Boolean,
    default: false
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  submittedAt: {
    type: Date
  }
}, {
  timestamps: true
});

dailyChallengeAttemptSchema.index({ challengeId: 1, studentEmail: 1, attemptNumber: 1 }, { unique: true });
dailyChallengeAttemptSchema.index({ challengeId: 1 });
dailyChallengeAttemptSchema.index({ challengeId: 1, studentEmail: 1, submitted: 1 });

module.exports = mongoose.model('DailyChallengeAttempt', dailyChallengeAttemptSchema);

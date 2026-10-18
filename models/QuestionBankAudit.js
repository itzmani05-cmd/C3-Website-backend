const mongoose = require('mongoose');

// Who changed the question bank and how. Written by routes/questionBank.js on every create/update/delete/bulk/import.
const auditSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  by: {
    type: String,
    default: 'unknown'
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  count: {
    type: Number,
    default: 1
  },
  summary: {
    type: String,
    default: ''
  }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

auditSchema.index({ createdAt: -1 });
auditSchema.index({ questionId: 1, createdAt: -1 });

module.exports = mongoose.model('QuestionBankAudit', auditSchema, 'QuestionBankAudit');

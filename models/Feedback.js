const mongoose = require('mongoose');

// Student feedback sent from the mobile app (the app's server writes these; this site reads them in the Feedback tab).
// Both use the same `feedbacks` collection, so keep this schema in step with C3App/server/models/Feedback.js.
const feedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: String,
  studentEmail: String,
  category: { type: String, enum: ['general', 'bug', 'content', 'suggestion'], default: 'general' },
  rating: { type: Number, min: 1, max: 5, default: null },
  message: { type: String, required: true },
  platform: String,
  appVersion: String,
  status: { type: String, enum: ['open', 'reviewed'], default: 'open' },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);

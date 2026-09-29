const mongoose = require('mongoose');

const testPatternSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: () => new mongoose.Types.ObjectId().toString() },
    name: { type: String, required: true, trim: true },
    numQuestions: { type: Number, required: true, min: 1 },
    marksPerQuestion: { type: Number, required: true, min: 0 },
    negativeMarkFraction: { type: Number, default: 0, min: 0, max: 1 }
  },
  { _id: false }
);

const testPatternPartSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: () => new mongoose.Types.ObjectId().toString() },
    name: { type: String, required: true, trim: true },
    sections: {
      type: [testPatternSectionSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A part needs at least one section'
      }
    }
  },
  { _id: false }
);

const testSchema = new mongoose.Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    publishToStudent: {
      type: Boolean,
      default: false
    },
    pattern: {
      type: [testPatternPartSchema],
      default: undefined
    },
    durationMinutes: {
      type: Number,
      default: 180,
      min: 1
    }
  },
  {
    timestamps: true,
    collection: 'Tests'
  }
);

module.exports = mongoose.model('Test', testSchema);

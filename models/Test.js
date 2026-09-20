const mongoose = require('mongoose');

// A section is a fixed-size, fixed-mark block of questions within a part (e.g. GATE's
// "5 questions worth 1 mark each" within "Part A - General Aptitude"). negativeMarkFraction
// is the fraction of marksPerQuestion deducted for a wrong single-choice answer (0 = none);
// it never applies to 'multiple' or 'numerical' answerType questions.
// `key` is a stable identifier that never changes even when `name` is edited later — it's what
// lets renaming a part/section in ManageTests cascade to already-tagged ExamQuestions instead of
// silently orphaning them (see PUT /tests/:id). The client generates it when adding a new
// part/section; the default here is only a safety net for direct API calls that omit it.
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
    // Absent/empty = a plain test (every question worth 1 mark, no negative marking, as before).
    // Present = a structured paper (e.g. GATE) with parts made of marks-weighted sections.
    pattern: {
      type: [testPatternPartSchema],
      default: undefined
    },
    // Minutes a student gets once they start this test; falls back to a 180-minute default
    // (routes/exam.js) for tests created before this field existed.
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

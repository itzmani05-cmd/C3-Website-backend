const mongoose = require('mongoose');

const curriculumSchema = new mongoose.Schema({
  unit: {
    type: String,
    required: true
  },
  topic: {
    type: String,
    required: true
  },
  subtopic: {
    type: String,
    required: true
  },
  order: {
    type: Number,
    default: 0
  }
});

// Compound index to ensure unique combinations
// curriculumSchema.index({ unit: 1, topic: 1, subtopic: 1 }, { unique: true });

module.exports = mongoose.model('Curriculum', curriculumSchema);

const mongoose = require('mongoose');

const examSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    }
  },
  {
    timestamps: true,
    collection: 'Exams'
  }
);

module.exports = mongoose.model('Exam', examSchema);

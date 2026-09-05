const mongoose = require('mongoose');

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
    }
  },
  {
    timestamps: true,
    collection: 'Tests' 
  }
);

module.exports = mongoose.model('Test', testSchema);

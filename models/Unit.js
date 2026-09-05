const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  order: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Unit', unitSchema);

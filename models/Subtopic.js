const mongoose = require('mongoose');

const subtopicSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  topicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Topic',
    required: true
  },
  order: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Subtopic', subtopicSchema);

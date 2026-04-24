const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true
  },
  order: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model('Topic', topicSchema);

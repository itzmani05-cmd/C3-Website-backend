const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
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

const mongoose = require('mongoose');

const testSchema = new mongoose.Schema(
  {
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

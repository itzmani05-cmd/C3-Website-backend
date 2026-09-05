const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true,
    enum: ['Admin', 'Student', 'admin', 'student']
  },
  status: {
    type: String,
    default: 'active',
    enum: ['active', 'inactive', 'blocked']
  },
  examIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Exam' }],
    default: []
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);

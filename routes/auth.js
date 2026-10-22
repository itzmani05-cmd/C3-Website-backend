const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const User = require('../models/User');
const Exam = require('../models/Exam');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
};

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);

// Only failed logins count, so many students signing in from one shared IP (a classroom) are not locked out.
// Limited per account and IP, plus a looser per-IP cap against one address trying many accounts.
const failedLoginOptions = {
  windowMs: 15 * 60 * 1000,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many failed login attempts. Please try again after 15 minutes.' }
};
const loginAccountLimiter = rateLimit({
  ...failedLoginOptions,
  limit: 8,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').trim().toLowerCase()}`
});
const loginIpLimiter = rateLimit({ ...failedLoginOptions, limit: 100, keyGenerator: (req) => ipKeyGenerator(req.ip) });
const loginRateLimiter = [loginIpLimiter, loginAccountLimiter];

router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || typeof role !== 'string') {
      return res.status(400).json({ message: 'Invalid payload structure' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRole = role.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ 
        message: `Your account is currently ${user.status}. Please contact the administrator.` 
      });
    }

    if (user.role.toLowerCase() !== normalizedRole) {
      return res.status(401).json({ 
        message: `Access denied: Account is not registered as a ${role}` 
      });
    }

    let isPasswordValid = false;
    if (isBcryptHash(user.password)) {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } else {
      isPasswordValid = typeof user.password === 'string' && user.password.length > 0 && password === user.password;
      if (isPasswordValid) {
        await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(password, 10) } });
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const userRole = user.role.toLowerCase();
    const token = jwt.sign(
      { email: user.email, role: userRole },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    res.status(200).json({
      token,
      role: userRole,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login router error:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  }
  catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email }).select('-password').populate('examIds', 'name');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving profile', error: error.message });
  }
});

const resolveExamIds = async (examIds) => {
  if (examIds === undefined) return undefined;
  if (!Array.isArray(examIds)) {
    throw new Error('examIds must be an array');
  }
  const uniqueIds = [...new Set(examIds)];
  const validIds = uniqueIds.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length !== uniqueIds.length) {
    throw new Error('examIds contains an invalid id');
  }
  const count = await Exam.countDocuments({ _id: { $in: validIds } });
  if (count !== validIds.length) {
    throw new Error('One or more exams could not be found');
  }
  return validIds;
};

router.get('/admin/students', verifyToken, isAdmin, async (req, res) => {
  try {
    const students = await User.find({ role: { $in: ['Student', 'student'] } })
      .select('-password')
      .populate('examIds', 'name')
      .sort({ name: 1, email: 1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving students', error: error.message });
  }
});

router.post('/admin/students', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, email, password, examIds } = req.body;
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Student name is required' });
    }
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ message: 'Student email is required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ message: 'A user with this email already exists' });
    }

    let resolvedExamIds;
    try {
      resolvedExamIds = await resolveExamIds(examIds);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const student = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'student',
      examIds: resolvedExamIds || []
    });
    await student.save();

    const { password: _pw, ...studentData } = student.toObject();
    res.status(201).json(studentData);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating student', error: error.message });
  }
});

router.put('/admin/students/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, email, status, examIds, password } = req.body;
    const update = {};

    if (password !== undefined && password !== '') {
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ message: 'New password must be at least 6 characters' });
      }
      update.password = await bcrypt.hash(password, 10);
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: 'Student name cannot be empty' });
      }
      update.name = name.trim();
    }
    if (email !== undefined) {
      if (!email.trim()) {
        return res.status(400).json({ message: 'Student email cannot be empty' });
      }
      update.email = email.trim().toLowerCase();
    }
    if (status !== undefined) {
      update.status = status;
    }
    if (examIds !== undefined) {
      try {
        update.examIds = await resolveExamIds(examIds);
      } catch (validationError) {
        return res.status(400).json({ message: validationError.message });
      }
    }

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: { $in: ['Student', 'student'] } },
      update,
      { new: true, runValidators: true }
    ).select('-password').populate('examIds', 'name');

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    res.json(student);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A user with this email already exists' });
    }
    res.status(500).json({ message: 'Server error updating student', error: error.message });
  }
});

router.delete('/admin/students/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const student = await User.findOneAndDelete({ _id: req.params.id, role: { $in: ['Student', 'student'] } });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting student', error: error.message });
  }
});

module.exports = { router, verifyToken };

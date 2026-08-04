const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');

const loginAttempts = {};

const loginRateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const limitWindow = 15 * 60 * 1000;
  const maxAttempts = 5;

  if (!loginAttempts[ip]) {
    loginAttempts[ip] = [];
  }

  loginAttempts[ip] = loginAttempts[ip].filter(timestamp => now - timestamp < limitWindow);

  if (loginAttempts[ip].length >= maxAttempts) {
    return res.status(429).json({
      message: 'Too many login attempts. Please try again after 15 minutes.'
    });
  }

  loginAttempts[ip].push(now);
  next();
};



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
    try {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } catch (e) {
      isPasswordValid = false;
    }

    if (!isPasswordValid) {
      isPasswordValid = (password === user.password);
    }

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const userRole = user.role.toLowerCase();
    const token = jwt.sign(
      { email: user.email, role: userRole },
      process.env.JWT_SECRET || 'defaultsecret',
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'defaultsecret');
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

// ─── GET /api/auth/admin/students ─────────────────────────────────────────────
router.get('/admin/students', verifyToken, isAdmin, async (req, res) => {
  try {
    const students = await User.find({ role: { $in: ['Student', 'student'] } })
      .select('-password')
      .sort({ name: 1, email: 1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Server error retrieving students', error: error.message });
  }
});

// ─── POST /api/auth/admin/students ────────────────────────────────────────────
router.post('/admin/students', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, email, password } = req.body;
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

    const hashedPassword = await bcrypt.hash(password, 10);
    const student = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'student'
    });
    await student.save();

    const { password: _pw, ...studentData } = student.toObject();
    res.status(201).json(studentData);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating student', error: error.message });
  }
});

// ─── PUT /api/auth/admin/students/:id ─────────────────────────────────────────
router.put('/admin/students/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, email, status } = req.body;
    const update = {};

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

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: { $in: ['Student', 'student'] } },
      update,
      { new: true, runValidators: true }
    ).select('-password');

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

// ─── DELETE /api/auth/admin/students/:id ──────────────────────────────────────
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

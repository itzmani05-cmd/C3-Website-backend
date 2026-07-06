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

module.exports = { router, verifyToken };

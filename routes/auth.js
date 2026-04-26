const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const ADMIN_PASSWORD = 'admin123';


router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { role: 'admin' },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '24h' }
    );

    res.json({ token, message: 'Login successful' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
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
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = { router, verifyToken };

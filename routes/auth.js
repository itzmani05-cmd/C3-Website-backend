const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { prisma } = require('../lib/prisma');
const { signToken, verifyToken } = require('../middleware/auth');
const { WITH_EXAMS, serializeUser } = require('../utils/userResponse');
const { serverError } = require('../utils/http');

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);

// Slows password guessing: 10 failed logins per IP per 15 minutes (successful logins don't count, so a
// school behind one IP isn't locked out).
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Checks the password, upgrading a legacy plain-text password to a bcrypt hash on success.
// Resolves to the user as stored after any upgrade, or null when the password is wrong.
const checkPassword = async (user, password) => {
  if (isBcryptHash(user.password)) {
    return (await bcrypt.compare(password, user.password)) ? user : null;
  }
  const matches = typeof user.password === 'string' && user.password.length > 0 && password === user.password;
  if (!matches) return null;
  return prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(password, 10) } });
};

router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || typeof role !== 'string') {
      return res.status(400).json({ message: 'Invalid payload structure' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRole = role.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
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

    const verifiedUser = await checkPassword(user, password);
    if (!verifiedUser) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const userRole = user.role.toLowerCase();
    res.status(200).json({
      token: signToken(verifiedUser),
      role: userRole,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login router error:', error);
    serverError(res, error, 'Server error');
  }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: req.user.email }, ...WITH_EXAMS });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(serializeUser(user));
  } catch (error) {
    serverError(res, error, 'Server error retrieving profile');
  }
});

module.exports = router;

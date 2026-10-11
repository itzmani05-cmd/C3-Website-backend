const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prisma, isValidId } = require('../lib/prisma');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
};

// Short fingerprint of the stored password hash. Changing the password changes it, which
// invalidates every token issued before the change.
const passwordVersion = (passwordHash) =>
  crypto.createHash('sha256').update(String(passwordHash)).digest('base64url').slice(0, 16);

// `user` needs { id, email, role, password }.
const signToken = (user) =>
  jwt.sign(
    { sub: user.id, email: user.email, role: String(user.role).toLowerCase(), pv: passwordVersion(user.password) },
    getJwtSecret(),
    { expiresIn: '24h' }
  );

const reject = (res, message) => res.status(401).json({ message });

// Requires `Authorization: Bearer <token>`. The account is re-checked on every request, so blocked or
// removed users, role changes and password changes take effect at once. Sets req.user = { sub, email, role }.
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return reject(res, 'No token provided');
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (error) {
    return reject(res, 'Invalid token');
  }

  try {
    const user = isValidId(payload.sub)
      ? await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, role: true, status: true, password: true }
        })
      : null;

    // Tokens issued before password versions existed carry no `pv`; those users sign in again.
    if (!user || payload.pv !== passwordVersion(user.password)) {
      return reject(res, 'Session expired. Please log in again.');
    }
    if (user.status !== 'active') {
      return reject(res, `Your account is currently ${user.status}. Please contact the administrator.`);
    }

    req.user = { sub: user.id, email: user.email, role: user.role.toLowerCase() };
    next();
  } catch (error) {
    console.error('Token check failed:', error);
    res.status(500).json({ message: 'Error checking session' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

module.exports = { signToken, verifyToken, isAdmin };

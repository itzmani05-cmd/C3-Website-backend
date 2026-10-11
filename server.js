const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const { prisma } = require('./lib/prisma');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Add it to the environment (Render → Environment) before starting.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

app.use(compression());
// Images are served to <img> tags on other origins (the admin site and the mobile app).
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS_ORIGINS: comma-separated admin site origins (e.g. https://admin.example.com). Unset allows any
// origin, which is only meant for local development.
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
if (allowedOrigins.length === 0) {
  console.warn('CORS_ORIGINS is not set: accepting requests from any origin. Set it in production.');
}
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));

// Question routes carry base64 images (150KB each, up to 6 per question) and bulk uploads; everything else is small.
app.use('/api/questions', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Per-IP cap on the whole API (images are skipped: pages load many <img> tags).
// Login has its own stricter limiter in routes/auth.js.
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3000,
    skip: (req) => req.path.startsWith('/images'),
    message: { message: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

prisma.$connect()
  .then(() => {
    console.log('Database connected');
    require('./jobs/dailyChallengeScheduler').startDailyChallengeScheduler();
    require('./jobs/imageCleanup').startImageCleanup();
  })
  .catch(err => console.error('Database connection error:', err));

const { verifyToken, isAdmin } = require('./middleware/auth');

// Public: image tags can't send the auth header.
app.use('/api/images', require('./routes/images'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth/admin/students', verifyToken, isAdmin, require('./routes/students'));
// Question bank goes last: its /:id routes would otherwise catch /exams, /tests, /curriculum, ...
app.use(
  '/api/questions',
  verifyToken,
  require('./routes/exams'),
  require('./routes/tests'),
  require('./routes/examQuestions'),
  require('./routes/curriculum'),
  require('./routes/questionBank')
);
app.use('/api/exam', verifyToken, require('./routes/exam'));
app.use('/api/daily-challenges', verifyToken, require('./routes/dailyChallenges'));
app.use('/api/question-papers', verifyToken, isAdmin, require('./routes/questionPapers'));
app.use('/api/feedback', verifyToken, isAdmin, require('./routes/feedback'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

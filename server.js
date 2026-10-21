const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Add it to the environment (Render → Environment) before starting.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/admin_panel_db')
  .then(() => {
    console.log('MongoDB Connected');
    require('./jobs/dailyChallengeScheduler').startDailyChallengeScheduler();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

const { router: authRouter } = require('./routes/auth');
app.use('/api/auth', authRouter);
app.use('/api/questions', require('./routes/questions'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/exam', require('./routes/exam'));
app.use('/api/daily-challenges', require('./routes/dailyChallenges'));
app.use('/api/question-bank', require('./routes/questionBank'));
app.use('/api/practice-questions', require('./routes/practiceQuestions'));
app.use('/api/feedback', require('./routes/feedback'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

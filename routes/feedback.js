// Student feedback inbox, mounted under /api/feedback. Admin only. Students send feedback from the mobile app.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Feedback = require('../models/Feedback');
const { verifyToken } = require('./auth');

const STATUSES = ['open', 'reviewed'];
const CATEGORIES = ['general', 'bug', 'content', 'suggestion'];
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Admin only' });
  }
};

router.use(verifyToken, isAdmin);

const firstString = (value) => (Array.isArray(value) ? value[0] : value);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const positiveInt = (value, fallback, max = Infinity) => {
  const number = Number.parseInt(firstString(value), 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
};

const serialize = (feedback) => ({
  _id: feedback._id,
  student: { id: feedback.userId, name: feedback.studentName || '', email: feedback.studentEmail || '' },
  category: feedback.category,
  rating: feedback.rating ?? null,
  message: feedback.message,
  platform: feedback.platform || '',
  appVersion: feedback.appVersion || '',
  status: feedback.status,
  reviewedAt: feedback.reviewedAt || null,
  createdAt: feedback.createdAt,
});

// A page of feedback, newest first, with the numbers the stat cards need.
router.get('/', async (req, res) => {
  try {
    const status = firstString(req.query.status);
    const category = firstString(req.query.category);
    const search = String(firstString(req.query.search) || '').trim().slice(0, 100);

    const filter = {};
    if (STATUSES.includes(status)) filter.status = status;
    if (CATEGORIES.includes(category)) filter.category = category;
    if (search) {
      // Matches the message or the student's name or email.
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ message: pattern }, { studentName: pattern }, { studentEmail: pattern }];
    }

    const pageSize = positiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const requestedPage = positiveInt(req.query.page, 1);

    const [total, openCount, allCount, ratingStats] = await Promise.all([
      Feedback.countDocuments(filter),
      Feedback.countDocuments({ status: 'open' }),
      Feedback.countDocuments({}),
      Feedback.aggregate([{ $match: { rating: { $ne: null } } }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const items = await Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    res.json({
      items: items.map(serialize),
      total,
      page,
      pageSize,
      totalPages,
      counts: { total: allCount, open: openCount, reviewed: allCount - openCount },
      rating: { average: ratingStats[0] ? Math.round(ratingStats[0].average * 10) / 10 : null, count: ratingStats[0]?.count || 0 },
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ message: 'Server error fetching feedback' });
  }
});

// Mark a message as reviewed, or open it again.
router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Feedback not found' });
    if (!STATUSES.includes(status)) return res.status(400).json({ message: `status must be one of: ${STATUSES.join(', ')}` });

    const updated = await Feedback.findByIdAndUpdate(
      req.params.id,
      { status, reviewedAt: status === 'reviewed' ? new Date() : null },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: 'Feedback not found' });

    res.json(serialize(updated));
  } catch (error) {
    console.error('Error updating feedback:', error);
    res.status(500).json({ message: 'Server error updating feedback' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Feedback not found' });
    const removed = await Feedback.findByIdAndDelete(req.params.id).lean();
    if (!removed) return res.status(404).json({ message: 'Feedback not found' });
    res.json({ message: 'Feedback deleted' });
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({ message: 'Server error deleting feedback' });
  }
});

module.exports = router;

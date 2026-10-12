// Student feedback inbox (mounted under /api/feedback, admin only). Students write it in the mobile app.
const express = require('express');
const router = express.Router();
const { prisma, isValidId, isNotFound } = require('../lib/prisma');
const { queryString, pageParams, pagedResponse, deleteById, serverError, userSearchFilter } = require('../utils/http');

const STATUSES = ['open', 'reviewed'];
const CATEGORIES = ['general', 'bug', 'content', 'suggestion'];

const WITH_STUDENT = { user: { select: { id: true, name: true, email: true } } };

const serialize = ({ user, ...feedback }) => ({ ...feedback, student: user });

router.get('/', async (req, res) => {
  try {
    const status = queryString(req.query.status);
    const category = queryString(req.query.category);
    const search = (queryString(req.query.search) || '').trim().slice(0, 100);
    const where = {
      ...(STATUSES.includes(status) ? { status } : {}),
      ...(CATEGORIES.includes(category) ? { category } : {}),
      // Matches the message, or the student's name or email.
      ...(search ? { OR: [{ message: { contains: search, mode: 'insensitive' } }, { user: { is: userSearchFilter(search) } }] } : {}),
    };

    const paging = pageParams(req.query) || { page: 1, pageSize: 10, skip: 0, take: 10 };
    const [items, total, open, all] = await Promise.all([
      prisma.feedback.findMany({ where, include: WITH_STUDENT, orderBy: { createdAt: 'desc' }, skip: paging.skip, take: paging.take }),
      prisma.feedback.count({ where }),
      prisma.feedback.count({ where: { status: 'open' } }),
      prisma.feedback.count(),
    ]);

    res.json({ ...pagedResponse(items.map(serialize), total, paging), counts: { total: all, open, reviewed: all - open } });
  } catch (error) {
    serverError(res, error, 'Server error fetching feedback');
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Feedback not found' });
    if (!STATUSES.includes(status)) return res.status(400).json({ message: `status must be one of: ${STATUSES.join(', ')}` });

    const updated = await prisma.feedback.update({
      where: { id: req.params.id },
      data: { status, reviewedAt: status === 'reviewed' ? new Date() : null },
      include: WITH_STUDENT,
    });
    res.json(serialize(updated));
  } catch (error) {
    if (isNotFound(error)) return res.status(404).json({ message: 'Feedback not found' });
    serverError(res, error, 'Server error updating feedback');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const removed = await deleteById(prisma.feedback, req.params.id);
    if (!removed) return res.status(404).json({ message: 'Feedback not found' });
    res.json({ message: 'Feedback deleted' });
  } catch (error) {
    serverError(res, error, 'Server error deleting feedback');
  }
});

module.exports = router;

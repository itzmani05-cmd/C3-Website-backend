const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Question = require('../models/Question');
const Unit = require('../models/Unit');
const Topic = require('../models/Topic');
const Subtopic = require('../models/Subtopic');
const { verifyToken } = require('./auth');

// Get all questions
router.get('/', async (req, res) => {
  try {
    const { unitId, topicId, subtopicId, status } = req.query;
    let query = {};

    if (unitId) query.unitId = unitId;
    if (topicId) query.topicId = topicId;
    if (subtopicId) query.subtopicId = subtopicId;
    if (status) query.status = status;

    const questions = await Question.find(query).sort({ timestamp: -1 });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { topicId, subtopicId } = req.body;

    if (!topicId) {
      return res.status(400).json({ message: 'topicId is required' });
    }
    if (!subtopicId) {
      req.body.subtopicId = null;
    }

    if (req.body.subtopicId) {
      const subtopic = await Subtopic.findById(req.body.subtopicId);

      if (!subtopic) {
        return res.status(400).json({ message: 'Invalid subtopicId' });
      }

      if (subtopic.topicId.toString() !== topicId) {
        return res.status(400).json({
          message: 'subtopic does not belong to given topic'
        });
      }
    }

    const question = new Question(req.body);
    await question.save();

    res.status(201).json(question);

  } catch (error) {
    console.error("🔥 ERROR:", error);
    console.error("🔥 BODY:", req.body);

    res.status(500).json({
      message: 'Server error',
      error: error.message
    });
  }
});

router.post('/upload', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ message: 'No image provided' });
    }
    res.json({ imageUrl: image });
  } catch (error) {
    res.status(500).json({ message: 'Upload error', error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json(question);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
// Bulk delete questions by topicId or subtopicId
router.delete('/delete/bulk', async (req, res) => {
  try {
    const { topicId, subtopicId } = req.query;
    let query = {};

    if (!topicId && !subtopicId) {
      return res.status(400).json({ message: 'At least topicId or subtopicId is required' });
    }

    if (subtopicId && subtopicId !== 'all') {
      query.subtopicId = subtopicId;
    } else if (topicId && topicId !== 'all') {
      query.topicId = topicId;
    }

    const result = await Question.deleteMany(query);
    res.json({ message: `Successfully deleted ${result.deletedCount} questions`, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json({ message: 'Question deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/stats/count', async (req, res) => {
  try {
    const { unitId, topicId, subtopicId } = req.query;
    let query = {};
    if (unitId) query.unitId = unitId;
    if (topicId) query.topicId = topicId;
    if (subtopicId) query.subtopicId = subtopicId;

    const count = await Question.countDocuments(query);
    res.json({ count, goal: 25 });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/by-subtopic/:subtopicId', async (req, res) => {
  try {
    const questions = await Question.find({ subtopicId: req.params.subtopicId });
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/curriculum', async (req, res) => {
  try {
    const units = await Unit.find().sort({ order: 1 });
    const topics = await Topic.find().sort({ order: 1 });
    const subtopics = await Subtopic.find().sort({ order: 1 });
    const hierarchy = [];

    for (const unit of units) {
      const unitData = {
        _id: unit._id.toString(),
        name: unit.name,
        topics: []
      };

      const unitTopics = topics.filter(t => t.unitId.toString() === unit._id.toString());
      for (const topic of unitTopics) {
        const topicData = {
          _id: topic._id.toString(),
          name: topic.name,
          subtopics: []
        };

        const topicSubtopics = subtopics.filter(st => st.topicId.toString() === topic._id.toString());
        for (const subtopic of topicSubtopics) {
          topicData.subtopics.push({
            _id: subtopic._id.toString(),
            name: subtopic.name
          });
        }

        unitData.topics.push(topicData);
      }
      hierarchy.push(unitData);
    }

    res.json(hierarchy);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid question id' });
    }

    const question = await Question.findById(req.params.id);
    if (!question) {
      return res.status(404).json({ message: 'Question not found' });
    }
    res.json(question);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Seed curriculum data
router.post('/curriculum/seed', async (req, res) => {
  try {
    await Unit.deleteMany({});
    await Topic.deleteMany({});
    await Subtopic.deleteMany({});

    const unit1 = await Unit.create({ name: "Unit 1: Building Materials & Construction Practices", order: 1 });
    const topic1_1 = await Topic.create({ name: "Building Materials", unitId: unit1._id, order: 1 });
    const topic1_2 = await Topic.create({ name: "Construction Practices", unitId: unit1._id, order: 2 });
    await Subtopic.create([
      { name: "Brick", topicId: topic1_1._id, order: 1 },
      { name: "Stones", topicId: topic1_1._id, order: 2 },
      { name: "Aggregates & M-Sand", topicId: topic1_1._id, order: 3 },
      { name: "Cement", topicId: topic1_1._id, order: 4 },
      { name: "Admixtures", topicId: topic1_1._id, order: 5 },
      { name: "Concrete (Self-compacting concrete)", topicId: topic1_1._id, order: 6 },
      { name: "Mix Design", topicId: topic1_1._id, order: 7 },
      { name: "Timber", topicId: topic1_1._id, order: 8 },
      { name: "Recycled and modern materials", topicId: topic1_1._id, order: 9 }
    ]);
    await Subtopic.create([
      { name: "Masonry", topicId: topic1_2._id, order: 1 },
      { name: "Construction Equipments", topicId: topic1_2._id, order: 2 },
      { name: "Building bye-laws", topicId: topic1_2._id, order: 3 },
      { name: "Fire safety, lighting and ventilation", topicId: topic1_2._id, order: 4 },
      { name: "Acoustics", topicId: topic1_2._id, order: 5 }
    ]);

    // Unit 2
    const unit2 = await Unit.create({ name: "Unit 2: Engineering Survey", order: 2 });
    const topic2_1 = await Topic.create({ name: "Surveying Fundamentals", unitId: unit2._id, order: 1 });
    const topic2_2 = await Topic.create({ name: "Advanced Surveying", unitId: unit2._id, order: 2 });
    await Subtopic.create([
      { name: "Basics of Surveying", topicId: topic2_1._id, order: 1 },
      { name: "Chain Surveying", topicId: topic2_1._id, order: 2 },
      { name: "Compass Surveying", topicId: topic2_1._id, order: 3 },
      { name: "Plane Table Surveying", topicId: topic2_1._id, order: 4 }
    ]);
    await Subtopic.create([
      { name: "Levelling", topicId: topic2_2._id, order: 1 },
      { name: "Computation of area and volume", topicId: topic2_2._id, order: 2 },
      { name: "Contouring", topicId: topic2_2._id, order: 3 },
      { name: "Theodolite surveying", topicId: topic2_2._id, order: 4 },
      { name: "Traversing", topicId: topic2_2._id, order: 5 },
      { name: "Tacheometry", topicId: topic2_2._id, order: 6 },
      { name: "Triangulation", topicId: topic2_2._id, order: 7 },
      { name: "Modern Surveying Techniques", topicId: topic2_2._id, order: 8 }
    ]);

    // Unit 3
    const unit3 = await Unit.create({ name: "Unit 3: Engineering Mechanics & Strength of Materials", order: 3 });
    const topic3_1 = await Topic.create({ name: "Engineering Mechanics", unitId: unit3._id, order: 1 });
    const topic3_2 = await Topic.create({ name: "Strength of Materials", unitId: unit3._id, order: 2 });
    await Subtopic.create([
      { name: "Forces: Types & Laws", topicId: topic3_1._id, order: 1 },
      { name: "CoG & MI", topicId: topic3_1._id, order: 2 },
      { name: "Friction", topicId: topic3_1._id, order: 3 }
    ]);
    await Subtopic.create([
      { name: "Stresses and Strains", topicId: topic3_2._id, order: 1 },
      { name: "Beams: SFD & BMD", topicId: topic3_2._id, order: 2 },
      { name: "Theory of simple bending", topicId: topic3_2._id, order: 3 },
      { name: "Deflection of beams", topicId: topic3_2._id, order: 4 },
      { name: "Torsion", topicId: topic3_2._id, order: 5 },
      { name: "Combined stresses", topicId: topic3_2._id, order: 6 },
      { name: "Stress Transformations & Failure Theories", topicId: topic3_2._id, order: 7 },
      { name: "Analysis of plane trusses", topicId: topic3_2._id, order: 8 }
    ]);

    res.json({ message: 'Curriculum seeded successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

// Shared helpers for tests that carry a structured Part/Section marks `pattern` (see models/Test.js).
// Both routes/exam.js (student-facing scoring/ordering) and routes/questions.js (admin cascade-rename)
// need the same "which section does this question belong to" logic, so it lives here once.

// Looks up a question's (part, section) in its test's pattern and returns the negative-mark
// fraction configured for that section, or 0 for plain tests / questions outside any pattern.
const buildNegativeFractionLookup = (testPattern) => {
  if (!Array.isArray(testPattern) || testPattern.length === 0) {
    return () => 0;
  }
  const bySectionKey = new Map();
  testPattern.forEach((part) => {
    (part.sections || []).forEach((section) => {
      bySectionKey.set(`${part.name}::${section.name}`, section.negativeMarkFraction || 0);
    });
  });
  return (q) => bySectionKey.get(`${q.part}::${q.section}`) || 0;
};

// Orders questions the way a real paper is laid out: Part A before Part B, and within a part,
// sections in the order they're defined (e.g. "1 Mark Questions" before "2 Mark Questions").
// Questions with no part/section (plain, non-patterned tests) or a stale/unmatched tag keep
// their relative order at the end (Array.prototype.sort is stable).
const sortQuestionsByPattern = (questions, testPattern) => {
  if (!Array.isArray(testPattern) || testPattern.length === 0) return questions;
  const rankBySectionKey = new Map();
  testPattern.forEach((part, partIdx) => {
    (part.sections || []).forEach((section, sectionIdx) => {
      rankBySectionKey.set(`${part.name}::${section.name}`, partIdx * 1000 + sectionIdx);
    });
  });
  const rankOf = (q) => {
    const key = `${q.part}::${q.section}`;
    return rankBySectionKey.has(key) ? rankBySectionKey.get(key) : Infinity;
  };
  return [...questions].sort((a, b) => rankOf(a) - rankOf(b));
};

// Attaches a `negativeMarks` figure (marks lost for a wrong single-choice answer, 0 otherwise) to
// each question so the student-facing exam UI can display the penalty before they answer.
const annotateNegativeMarks = (questions, testPattern) => {
  const negativeFractionFor = buildNegativeFractionLookup(testPattern);
  return questions.map((q) => {
    const plain = typeof q.toObject === 'function' ? q.toObject() : q;
    const marks = typeof plain.marks === 'number' && plain.marks > 0 ? plain.marks : 1;
    const negativeMarks = plain.answerType === 'single' ? parseFloat((marks * negativeFractionFor(plain)).toFixed(2)) : 0;
    return { ...plain, negativeMarks };
  });
};

module.exports = { buildNegativeFractionLookup, sortQuestionsByPattern, annotateNegativeMarks };

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

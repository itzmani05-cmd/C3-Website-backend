const express = require('express');
const router = express.Router();
const axios = require('axios');

// Local smart extract - handles multiple formats including inline paragraph format
function localSmartExtract(textContent, unitId, topicId, subtopicId, maxQuestions = 25) {
  const questions = [];
  textContent = textContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  console.log(`Extracting from text of length: ${textContent.length}`);

  // Strategy: Split by "Question X:" pattern to get individual questions
  // Each question ends with a period followed by blank lines or next "Question Y:"

  // Find all "Question X:" patterns
  const questionPattern = /Question\s+\d+:/gi;
  const questionMatches = [];
  let match;
  while ((match = questionPattern.exec(textContent)) !== null) {
    questionMatches.push({ index: match.index, text: match[0] });
  }

  console.log(`Found ${questionMatches.length} "Question X:" occurrences`);

  if (questionMatches.length === 0) {
    // Fallback: try the old method with "Options:"
    console.log('No "Question X:" found, trying Options: method');
    return extractByOptions(textContent, unitId, topicId, subtopicId, maxQuestions);
  }

  for (let i = 0; i < questionMatches.length; i++) {
    if (questions.length >= maxQuestions) break;

    try {
      const qStart = questionMatches[i].index;
      const qEnd = (i < questionMatches.length - 1) ? questionMatches[i + 1].index : textContent.length;

      let block = textContent.substring(qStart, qEnd).trim();
      console.log(`Question ${questions.length + 1} block length: ${block.length}`);

      if (!block || block.length < 30) {
        console.log('Block too short, skipping');
        continue;
      }

      // Remove the "Question X:" prefix from the block for parsing
      block = block.replace(/^Question\s+\d+:\s*/i, '');

        // First, let's extract components using regex patterns directly from the block
        // This is more reliable than line-by-line parsing for inline formats

        // Extract question text (everything before "Options:")
        const qMatch = block.match(/^([\s\S]*?)Options:/i);
        const qText = qMatch ? qMatch[1].trim() : '';
        console.log(`Question text: ${qText.substring(0, 50)}...`);

        // Extract options section (between Options: and Correct Answer:)
        const optionsMatch = block.match(/Options:([\s\S]*?)(?:Correct Answer:|$)/i);
        let optionsText = optionsMatch ? optionsMatch[1].trim() : '';

        // Parse individual options from the options text
        const options = { a: 'Not found', b: 'Not found', c: 'Not found', d: 'Not found' };

        // Find all option patterns like (a) text, (b) text, etc.
        const optPattern = /[\[(]([a-dA-D])[\])][.\)]?\s*([^([\n]*?)(?=[\[(][b-dB-D][\])]|Correct Answer:|Detailed Explanation:|$)/gi;
        let optMatch;
        while ((optMatch = optPattern.exec(optionsText)) !== null) {
          const letter = optMatch[1].toLowerCase();
          const text = optMatch[2].trim();
          if (options[letter] !== undefined && text) {
            options[letter] = text;
          }
        }

        // If regex didn't work, try line by line
        if (Object.values(options).every(v => v === 'Not found')) {
          const optLines = optionsText.split(/\n|(?=[\[(][a-dA-D][\])])/);
          for (const line of optLines) {
            const match = line.match(/^[\[(]?([a-dA-D])[\])]?[.\)]?\s*(.+)$/i);
            if (match) {
              const letter = match[1].toLowerCase();
              const text = match[2].trim();
              if (options[letter] !== undefined && text) {
                options[letter] = text;
              }
            }
          }
        }

        console.log(`Options: A=${options.a.substring(0, 20)}..., B=${options.b.substring(0, 20)}...`);

        // Extract correct answer
        let correctAns = 'a';
        const ansMatch = block.match(/Correct Answer:\s*[\[(]?([a-dA-D])[\])]?/i);
        if (ansMatch) {
          correctAns = ansMatch[1].toLowerCase();
        }
        console.log(`Correct answer: ${correctAns}`);

        // Extract explanation (everything after "Detailed Explanation:")
        let explanation = '';
        const expMatch = block.match(/Detailed Explanation:([\s\S]*?)$/i);
        if (expMatch) {
          explanation = expMatch[1].trim();
          console.log(`Explanation extracted: ${explanation.substring(0, 80)}...`);
        } else {
          console.log('No Detailed Explanation found in block');
          console.log('Block end:', block.substring(block.length - 100));
        }

        if (!qText || qText.length < 10) continue;
        const validOptions = Object.values(options).filter(v => v && v !== 'Not found');
        if (validOptions.length < 2) continue;

        questions.push({
          question: qText,
          options,
          correctAnswer: correctAns,
          explanation: explanation || 'No explanation provided.',
          type: 'Theory-based MCQ',
          unitId,
          topicId,
          subtopicId
        });
        console.log(`Question ${questions.length} added successfully`);
      } catch (err) {
        console.error('Error parsing question:', err);
        continue;
      }
    }

  console.log(`Total questions extracted: ${questions.length}`);
  return { success: true, questions };
}

// Local extract endpoint
router.post('/extract', (req, res) => {
  try {
    const { textContent, unitId, topicId, subtopicId, maxQuestions = 25 } = req.body;
    const result = localSmartExtract(textContent, unitId, topicId, subtopicId, maxQuestions);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Gemini AI generation endpoint
router.post('/generate', async (req, res) => {
  try {
    const { textContent, subject, subtopic } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'Server configuration error: API key not configured' });
    }

    if (!textContent || textContent.length < 100) {
      return res.status(400).json({ error: 'Content is too short' });
    }

    const systemMsg = `You are a high-fidelity Question Extractor for TNPSC AE civil engineering exams.
Subject: ${subject}, Subtopic: ${subtopic}
Use Unicode symbols (σ, ε, τ, θ, π, √, ≤, ≥, Δ) instead of words like "sigma".
TEXT SOURCE: ${textContent}`;

    const prompt = `Output JSON in this structure:
[{"question": "...", "options": {"a": "...", "b": "...", "c": "...", "d": "..."},
  "correct_answer": "a", "explanation": "...", "type": "Theory-based MCQ"}]
Return RAW JSON only.`;

    // Call Gemini API
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            { text: systemMsg },
            { text: prompt }
          ]
        }]
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    let rawText = response.data.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json\s*|```/g, '').trim();
    
    const jsonData = JSON.parse(rawText);
    for (const q of jsonData) {
      q.subject = subject;
      q.subcategory = subtopic;
    }
    
    res.json({ success: true, questions: jsonData });
  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({ 
      error: error.response?.data?.error?.message || error.message 
    });
  }
});

// Fallback extraction method using Options:
function extractByOptions(textContent, unitId, topicId, subtopicId, maxQuestions) {
  const questions = [];

  // Find all "Options:" positions
  const optionsRegex = /Options:/gi;
  const optionsMatches = [];
  let match;
  while ((match = optionsRegex.exec(textContent)) !== null) {
    optionsMatches.push(match.index);
  }

  console.log(`Fallback: Found ${optionsMatches.length} "Options:" occurrences`);

  for (let i = 0; i < optionsMatches.length && questions.length < maxQuestions; i++) {
    try {
      let questionStart = 0;
      if (i > 0) {
        // Find end of previous question
        const prevEnd = optionsMatches[i - 1];
        const textBetween = textContent.substring(prevEnd, optionsMatches[i]);
        const expMatch = textBetween.match(/Detailed Explanation:[\s\S]*?\.\s*(?=\n|$)/);
        if (expMatch) {
          questionStart = prevEnd + textBetween.indexOf(expMatch[0]) + expMatch[0].length;
        }
      }

      const questionEnd = (i < optionsMatches.length - 1) ? optionsMatches[i + 1] : textContent.length;
      let block = textContent.substring(questionStart, questionEnd).trim();

      if (!block || block.length < 30) continue;

      // Parse the block
      const qMatch = block.match(/^([\s\S]*?)Options:/i);
      const qText = qMatch ? qMatch[1].trim() : '';

      const optionsMatch = block.match(/Options:([\s\S]*?)(?:Correct Answer:|$)/i);
      let optionsText = optionsMatch ? optionsMatch[1].trim() : '';

      const options = { a: 'Not found', b: 'Not found', c: 'Not found', d: 'Not found' };
      const optPattern = /[\[(]([a-dA-D])[\])][.\)]?\s*([^([\n]*?)(?=[\[(][b-dB-D][\])]|Correct Answer:|Detailed Explanation:|$)/gi;
      let optMatch;
      while ((optMatch = optPattern.exec(optionsText)) !== null) {
        const letter = optMatch[1].toLowerCase();
        const text = optMatch[2].trim();
        if (options[letter] !== undefined && text) {
          options[letter] = text;
        }
      }

      const ansMatch = block.match(/Correct Answer:\s*[\[(]?([a-dA-D])[\])]?/i);
      const correctAns = ansMatch ? ansMatch[1].toLowerCase() : 'a';

      const expMatch = block.match(/Detailed Explanation:([\s\S]*?)$/i);
      const explanation = expMatch ? expMatch[1].trim() : '';

      if (qText && qText.length >= 10 && Object.values(options).some(v => v !== 'Not found')) {
        questions.push({
          question: qText,
          options,
          correct_answer: correctAns,
          explanation: explanation || 'No explanation provided.',
          type: 'Theory-based MCQ',
          unitId,
          topicId,
          subtopicId
        });
      }
    } catch (err) {
      console.error('Error in fallback extraction:', err);
    }
  }

  return { success: true, questions };
}

module.exports = router;

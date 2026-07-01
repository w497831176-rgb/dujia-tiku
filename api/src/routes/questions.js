const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 获取题目列表（内测阶段返回完整数据，含答案、解析、变式题）
router.get('/', auth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(
    'SELECT id, type, stem, answer, analysis, wrong_analysis as wrongAnalysis, knowledge_review as knowledgeReview, knowledge_tag as knowledgeTag, options, variants FROM questions ORDER BY id'
  );
  const questions = rows.map(q => ({
    id: q.id,
    type: q.type,
    stem: q.stem,
    answer: q.answer,
    analysis: q.analysis,
    wrongAnalysis: q.wrongAnalysis,
    knowledgeReview: q.knowledgeReview,
    knowledgeTag: q.knowledgeTag,
    options: JSON.parse(q.options),
    variants: JSON.parse(q.variants || '[]')
  }));
  res.json({ questions });
});

// 获取题目详情（含答案、解析、变式题）
router.get('/:id', auth, async (req, res) => {
  const db = await getDb();
  const q = await db.get(
    'SELECT id, type, stem, answer, analysis, wrong_analysis as wrongAnalysis, knowledge_review as knowledgeReview, knowledge_tag as knowledgeTag, options, variants FROM questions WHERE id = ?',
    req.params.id
  );
  if (!q) return res.status(404).json({ error: '题目不存在' });

  res.json({
    id: q.id,
    type: q.type,
    stem: q.stem,
    answer: q.answer,
    analysis: q.analysis,
    wrongAnalysis: q.wrongAnalysis,
    knowledgeReview: q.knowledgeReview,
    knowledgeTag: q.knowledgeTag,
    options: JSON.parse(q.options),
    variants: JSON.parse(q.variants || '[]')
  });
});

// 导入种子数据（内测用）
router.post('/seed', async (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions)) {
    return res.status(400).json({ error: 'questions 必须是数组' });
  }

  const db = await getDb();
  let count = 0;
  for (const q of questions) {
    await db.run(
      'INSERT OR REPLACE INTO questions (id, type, stem, options, answer, analysis, wrong_analysis, knowledge_review, knowledge_tag, variants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      q.id,
      q.type,
      q.stem,
      JSON.stringify(q.options),
      q.answer,
      q.analysis,
      q.wrongAnalysis,
      q.knowledgeReview,
      q.knowledgeTag,
      JSON.stringify(q.variants || [])
    );
    count++;
  }

  res.json({ message: `已导入 ${count} 道题` });
});

module.exports = router;

const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 提交答题
router.post('/', auth, async (req, res) => {
  const { questionId, selected } = req.body;
  const db = await getDb();

  const question = await db.get('SELECT answer FROM questions WHERE id = ?', questionId);
  if (!question) return res.status(404).json({ error: '题目不存在' });

  const isCorrect = selected === question.answer;

  await db.run(
    `INSERT INTO answers (user_id, question_id, selected, is_correct) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, question_id) DO UPDATE SET selected=excluded.selected, is_correct=excluded.is_correct, created_at=CURRENT_TIMESTAMP`,
    req.userId, questionId, selected, isCorrect ? 1 : 0
  );

  if (!isCorrect) {
    const existing = await db.get('SELECT id, count FROM wrong_questions WHERE user_id = ? AND question_id = ?', req.userId, questionId);
    if (existing) {
      await db.run('UPDATE wrong_questions SET count = count + 1, last_wrong_at = CURRENT_TIMESTAMP WHERE id = ?', existing.id);
    } else {
      await db.run('INSERT INTO wrong_questions (user_id, question_id, count) VALUES (?, ?, 1)', req.userId, questionId);
    }
  } else {
    await db.run('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?', req.userId, questionId);
  }

  const stats = await db.get(
    'SELECT COUNT(*) as total, SUM(is_correct) as correct FROM answers WHERE user_id = ?',
    req.userId
  );

  res.json({
    isCorrect,
    correctAnswer: question.answer,
    stats: {
      totalAnswered: stats.total,
      totalCorrect: stats.correct || 0,
      accuracy: stats.total ? Math.round((stats.correct / stats.total) * 100) : 0
    }
  });
});

// 获取当前用户所有答题记录
router.get('/', auth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all('SELECT question_id as questionId, selected, is_correct as isCorrect FROM answers WHERE user_id = ?', req.userId);
  const answers = {};
  for (const row of rows) {
    answers[row.questionId] = {
      selected: row.selected,
      isCorrect: row.isCorrect === 1
    };
  }
  res.json({ answers, total: rows.length });
});

// 全部重置（清空答题记录和统计，保留错题集）
router.post('/reset', auth, async (req, res) => {
  const db = await getDb();
  await db.run('DELETE FROM answers WHERE user_id = ?', req.userId);
  res.json({ message: '答题记录已重置' });
});

module.exports = router;

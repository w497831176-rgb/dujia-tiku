const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 获取错题集列表
router.get('/', auth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(`
    SELECT wq.question_id as id, wq.count, q.stem, q.type, q.knowledge_tag
    FROM wrong_questions wq
    JOIN questions q ON wq.question_id = q.id
    WHERE wq.user_id = ?
    ORDER BY wq.count DESC, wq.question_id ASC
  `, req.userId);

  res.json({ wrongQuestions: rows });
});

// 删除单条错题
router.delete('/:questionId', auth, async (req, res) => {
  const db = await getDb();
  await db.run('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?', req.userId, req.params.questionId);
  res.json({ message: '已删除' });
});

// 清空错题集
router.post('/clear', auth, async (req, res) => {
  const db = await getDb();
  await db.run('DELETE FROM wrong_questions WHERE user_id = ?', req.userId);
  res.json({ message: '错题集已清空' });
});

module.exports = router;

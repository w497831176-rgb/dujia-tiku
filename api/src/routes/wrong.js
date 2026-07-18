const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 获取错题集列表
router.get('/', auth, async (req, res) => {
  const db = await getDb();
  await db.run(`
    DELETE FROM wrong_questions
    WHERE user_id = ?
      AND (
        NOT EXISTS (
          SELECT 1
          FROM answers a0
          WHERE a0.user_id = wrong_questions.user_id
            AND a0.question_id = wrong_questions.question_id
        )
        OR EXISTS (
        SELECT 1
        FROM answers latest
        JOIN questions q ON q.id = wrong_questions.question_id
        WHERE latest.id = (
          SELECT a2.id
          FROM answers a2
          WHERE a2.user_id = wrong_questions.user_id
            AND a2.question_id = wrong_questions.question_id
          ORDER BY datetime(a2.created_at) DESC, a2.id DESC
          LIMIT 1
        )
          AND (latest.is_correct = 1 OR latest.selected = q.answer)
        )
      )
  `, req.userId);

  const rows = await db.all(`
    SELECT wq.question_id as id, wq.count, q.stem, q.type, q.knowledge_tag
    FROM wrong_questions wq
    JOIN questions q ON wq.question_id = q.id
    LEFT JOIN answers a ON a.id = (
      SELECT a2.id
      FROM answers a2
      WHERE a2.user_id = wq.user_id
        AND a2.question_id = wq.question_id
      ORDER BY datetime(a2.created_at) DESC, a2.id DESC
      LIMIT 1
    )
    WHERE wq.user_id = ?
      AND a.id IS NOT NULL
      AND COALESCE(a.is_correct, 0) = 0
      AND COALESCE(a.selected, '') <> q.answer
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

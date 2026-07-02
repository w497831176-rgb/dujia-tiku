const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const PRICES = {
  wrong_collection: 2.9,
  knowledge_all: 99.9,
  ai_extract: 9.9
};

// 获取当前用户购买状态
router.get('/', auth, async (req, res) => {
  const db = await getDb();
  let p = await db.get('SELECT * FROM purchases WHERE user_id = ?', req.userId);
  if (!p) {
    await db.run('INSERT OR IGNORE INTO purchases (user_id) VALUES (?)', req.userId);
    p = { wrong_collection: 0, knowledge_all: 0, ai_extract_count: 0 };
  }
  res.json({
    wrong_collection: p.wrong_collection === 1,
    knowledge_all: p.knowledge_all === 1,
    ai_extract_count: p.ai_extract_count
  });
});

// 测试版购买
router.post('/buy', auth, async (req, res) => {
  const { type } = req.body;
  if (!['wrong_collection', 'knowledge_all', 'ai_extract'].includes(type)) {
    return res.status(400).json({ error: '无效的购买类型' });
  }

  const db = await getDb();
  if (type === 'ai_extract') {
    await db.run('UPDATE purchases SET ai_extract_count = ai_extract_count + 1 WHERE user_id = ?', req.userId);
  } else {
    await db.run(`UPDATE purchases SET ${type} = 1 WHERE user_id = ?`, req.userId);
  }

  const p = await db.get('SELECT * FROM purchases WHERE user_id = ?', req.userId);
  res.json({
    message: '购买成功（测试版核销）',
    price: PRICES[type],
    purchases: {
      wrong_collection: p.wrong_collection === 1,
      knowledge_all: p.knowledge_all === 1,
      ai_extract_count: p.ai_extract_count
    }
  });
});

module.exports = router;

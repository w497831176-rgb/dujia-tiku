const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 获取当前用户的邀请数据
router.get('/', auth, async (req, res) => {
  const db = await getDb();
  const user = await db.get('SELECT invite_code, inviter_code FROM users WHERE id = ?', req.userId);

  const invitees = await db.all(`
    SELECT u.username, u.created_at as registerTime, p.wrong_collection, p.knowledge_all, p.ai_extract_count
    FROM users u
    LEFT JOIN purchases p ON u.id = p.user_id
    WHERE u.inviter_code = ?
  `, user.invite_code);

  const inviteeList = invitees.map(u => ({
    username: u.username,
    registerTime: u.registerTime,
    hasPurchased: u.wrong_collection === 1 || u.knowledge_all === 1 || u.ai_extract_count > 0,
    purchaseItems: [
      ...(u.wrong_collection === 1 ? ['wrong_collection'] : []),
      ...(u.knowledge_all === 1 ? ['knowledge_all'] : []),
      ...(u.ai_extract_count > 0 ? ['ai_extract'] : [])
    ]
  }));

  const rewards = await db.all(`
    SELECT u.username as source, ir.reward_type as type, ir.created_at as obtainedAt
    FROM invite_records ir
    JOIN users u ON ir.invitee_id = u.id
    WHERE ir.inviter_id = ?
  `, req.userId);

  res.json({
    inviteCode: user.invite_code,
    inviterCode: user.inviter_code,
    inviteCount: inviteeList.length,
    invitees: inviteeList,
    rewards
  });
});

module.exports = router;

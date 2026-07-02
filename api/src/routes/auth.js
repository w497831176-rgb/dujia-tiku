const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { JWT_SECRET, auth } = require('../middleware/auth');

const router = express.Router();

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = 'D';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// 获取当前登录用户信息
router.get('/me', auth, async (req, res) => {
  const db = await getDb();
  const user = await db.get('SELECT id, username, invite_code, inviter_code FROM users WHERE id = ?', req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({
    id: user.id,
    username: user.username,
    inviteCode: user.invite_code,
    inviterCode: user.inviter_code
  });
});

// 注册
router.post('/register', async (req, res) => {
  const { username, password, confirmPassword, inviteCode } = req.body;
  const db = await getDb();

  if (!username || username.length < 2) {
    return res.status(400).json({ error: '用户名至少 2 个字符' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: '密码至少 4 位' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: '两次输入的密码不一致' });
  }

  const existing = await db.get('SELECT id FROM users WHERE username = ?', username);
  if (existing) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  let myInviteCode = generateInviteCode();
  while (await db.get('SELECT id FROM users WHERE invite_code = ?', myInviteCode)) {
    myInviteCode = generateInviteCode();
  }

  let inviterId = null;
  if (inviteCode) {
    const inviter = await db.get('SELECT id FROM users WHERE invite_code = ?', inviteCode);
    if (inviter) inviterId = inviter.id;
  }

  const result = await db.run(
    'INSERT INTO users (username, password_hash, invite_code, inviter_code) VALUES (?, ?, ?, ?)',
    username, passwordHash, myInviteCode, inviteCode || null
  );

  const userId = result.lastID;

  await db.run('INSERT OR IGNORE INTO purchases (user_id) VALUES (?)', userId);

  if (inviterId) {
    await db.run('INSERT INTO invite_records (inviter_id, invitee_id, reward_type) VALUES (?, ?, ?)',
      inviterId, userId, 'register');
  }

  const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });

  res.json({
    token,
    user: { id: userId, username, inviteCode: myInviteCode, inviterCode: inviteCode || null }
  });
});

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();

  const user = await db.get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

  res.json({
    token,
    user: { id: user.id, username: user.username, inviteCode: user.invite_code, inviterCode: user.inviter_code }
  });
});

// 修改密码
router.post('/change-password', auth, async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;
  const db = await getDb();

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: '两次输入的新密码不一致' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: '新密码至少 4 位' });
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', req.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: '原密码错误' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', newHash, user.id);

  res.json({ message: '密码修改成功' });
});

module.exports = router;

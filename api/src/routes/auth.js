const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { JWT_SECRET, auth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', auth, async (req, res) => {
  const db = await getDb();
  const user = await db.get('SELECT id, username FROM users WHERE id = ?', req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

router.post('/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;
  if (!username || username.length < 2) return res.status(400).json({ error: '用户名至少 2 个字符' });
  if (!password || password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  if (password !== confirmPassword) return res.status(400).json({ error: '两次输入的密码不一致' });
  const db = await getDb();
  if (await db.get('SELECT id FROM users WHERE username = ?', username)) return res.status(400).json({ error: '用户名已存在' });
  const result = await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', username, bcrypt.hashSync(password, 10));
  const token = jwt.sign({ userId: result.lastID, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: result.lastID, username } });
});

router.post('/login', async (req, res) => {
  const db = await getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ?', req.body.username);
  if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username } });
});

module.exports = router;

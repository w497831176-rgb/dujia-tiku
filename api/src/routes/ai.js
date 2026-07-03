const express = require('express');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-pro';
const AI_THINKING = process.env.AI_THINKING !== 'disabled';
const AI_REASONING_EFFORT = process.env.AI_REASONING_EFFORT === 'max' ? 'max' : 'high';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    const errText = await response.text().catch(() => '');
    lastError = new Error(`AI API error: ${response.status} ${errText}`);

    if (response.status === 429 || response.status >= 500) {
      if (i < maxRetries) {
        const delay = 2000 * Math.pow(2, i);
        console.log(`AI API ${response.status}, retrying in ${delay}ms... (${i + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
    }

    throw lastError;
  }
  throw lastError;
}

function buildPrompt(questions, type) {
  const header = type === 'all'
    ? '请根据以下人工智能训练师三级考试题目，生成一份考前3小时屏幕速记指南。'
    : '请根据以下错题，生成一份针对性复习指南。';

  const questionText = questions.map((q, idx) => {
    const opts = q.options || {};
    const optionLines = Object.keys(opts).sort().map(k => `${k}. ${opts[k]}`).join('  ');
    return `${idx + 1}. [${q.type || '单选题'}] ${q.stem}\n选项：${optionLines}\n答案：${q.answer || ''}`;
  }).join('\n\n');

  return `${header}\n\n${questionText}\n\n要求（必须严格遵守）：\n1. 只输出 Markdown 表格，不要输出表格外的解释、引言或总结文字\n2. 按知识点分块；每个知识点用一个 Markdown 表格呈现，表头固定为三列：考点 | 关键内容 | 易错提示\n3. 每个单元格字数控制在 25 字以内，过长内容请拆成多条短句\n4. 重点突出易错点\n5. 语言简洁，适合考前速记`;
}

// 提取错题/全部题目并生成报告
router.post('/extract', auth, async (req, res) => {
  const { type } = req.body;
  const db = await getDb();

  let p = await db.get('SELECT * FROM purchases WHERE user_id = ?', req.userId);
  if (!p) return res.status(403).json({ error: '无购买记录' });

  if (type === 'all' && p.knowledge_all !== 1) {
    return res.status(403).json({ error: '未解锁知识点全集' });
  }
  if (type === 'wrong' && p.ai_extract_count < 1) {
    // 测试版：点击提炼错题即自动购买 1 次
    await db.run('UPDATE purchases SET ai_extract_count = ai_extract_count + 1 WHERE user_id = ?', req.userId);
    p = await db.get('SELECT * FROM purchases WHERE user_id = ?', req.userId);
  }

  let questions = [];
  if (type === 'all') {
    questions = await db.all('SELECT * FROM questions ORDER BY id');
  } else {
    const wrongIds = await db.all('SELECT question_id FROM wrong_questions WHERE user_id = ?', req.userId);
    for (const row of wrongIds) {
      const q = await db.get('SELECT * FROM questions WHERE id = ?', row.question_id);
      if (q) questions.push(q);
    }
  }

  if (questions.length === 0) {
    return res.status(400).json({ error: '没有可提炼的题目' });
  }

  questions = questions.map(q => ({ ...q, options: JSON.parse(q.options) }));

  if (!AI_API_KEY) {
    return res.status(500).json({ error: '未配置 AI API Key' });
  }

  try {
    const response = await fetchWithRetry(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        thinking: { type: AI_THINKING ? 'enabled' : 'disabled' },
        reasoning_effort: AI_REASONING_EFFORT,
        messages: [
          { role: 'system', content: '你是一位人工智能训练师三级考试辅导专家。' },
          { role: 'user', content: buildPrompt(questions, type) }
        ]
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content || !content.trim()) {
      throw new Error('AI 返回内容为空，请稍后重试');
    }

    if (type === 'wrong') {
      await db.run('UPDATE purchases SET ai_extract_count = ai_extract_count - 1 WHERE user_id = ?', req.userId);
    }

    const result = await db.run(
      'INSERT INTO extract_reports (user_id, type, wrong_count, content) VALUES (?, ?, ?, ?)',
      req.userId, type, questions.length, content
    );

    res.json({
      id: result.lastID,
      type,
      wrongCount: questions.length,
      content
    });
  } catch (err) {
    console.error('AI extract error:', err);
    res.status(500).json({ error: 'AI 生成失败：' + err.message });
  }
});

// 获取报告列表
router.get('/reports', auth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all('SELECT id, type, wrong_count, content, created_at FROM extract_reports WHERE user_id = ? ORDER BY created_at DESC', req.userId);
  res.json({ reports: rows });
});

// 获取报告详情
router.get('/reports/:id', auth, async (req, res) => {
  const db = await getDb();
  const row = await db.get('SELECT * FROM extract_reports WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: '报告不存在' });
  res.json(row);
});

module.exports = router;

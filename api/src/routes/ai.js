const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-pro';
const AI_THINKING = process.env.AI_THINKING !== 'disabled';
const AI_REASONING_EFFORT = process.env.AI_REASONING_EFFORT === 'max' ? 'max' : 'high';
const DIAGNOSIS_MAX_WRONGS = Math.min(Math.max(Number(process.env.AI_DIAGNOSIS_MAX_WRONGS || 200), 1), 200);
const DIAGNOSIS_PROMPT_VERSION = 'v1.3-prompt-002';
const DIAGNOSIS_SKILL_VERSION = 'wrong-answer-diagnosis@v1.3.0';
const WEAK_PRACTICE_PROMPT_VERSION = 'v1.4-weak-practice-prompt-001';
const WEAK_PRACTICE_SKILL_VERSION = 'weak-practice-generation@v1.4.0';
const WEAK_PRACTICE_REVIEW_SKILL_VERSION = 'weak-practice-review@v1.4.0';
const EXTRACT_PROMPT_VERSION = 'v1.3-extract-wrong-prompt-002';
const EXTRACT_SKILL_VERSION = 'wrong-answer-extract@v1.3.0';
const WRONG_EXTRACT_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'ai-extract-wrong.md');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ACTIVE_WRONG_ANSWER_JOIN = `
  LEFT JOIN answers a ON a.id = (
    SELECT a2.id
    FROM answers a2
    WHERE a2.user_id = wq.user_id
      AND a2.question_id = wq.question_id
    ORDER BY datetime(a2.created_at) DESC, a2.id DESC
    LIMIT 1
  )
`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requireAdmin(req, res, next) {
  if (req.username !== ADMIN_USERNAME) {
    return res.status(403).json({ error: '仅管理员可查看 AI badcase 运维记录' });
  }
  next();
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    const errText = await response.text().catch(() => '');
    lastError = new Error(`AI API error: ${response.status} ${errText}`);

    if ((response.status === 429 || response.status >= 500) && i < maxRetries) {
      const delay = 2000 * Math.pow(2, i);
      console.log(`AI API ${response.status}, retrying in ${delay}ms... (${i + 1}/${maxRetries})`);
      await sleep(delay);
      continue;
    }

    throw lastError;
  }
  throw lastError;
}

function safeJsonParse(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function extractJsonObject(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('AI response is empty');
  }
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw err;
  }
}

function shanghaiNow() {
  return formatShanghaiDateTime(new Date());
}

function formatShanghaiDateTime(value) {
  const date = value ? new Date(value) : new Date();
  const shanghai = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shanghai.toISOString().slice(0, 19).replace('T', ' ');
}

function aiPayload(messages, extra = {}) {
  return {
    model: AI_MODEL,
    thinking: { type: AI_THINKING ? 'enabled' : 'disabled' },
    reasoning_effort: AI_REASONING_EFFORT,
    messages,
    ...extra
  };
}

function normalizeKnowledgeKey(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function splitKnowledgeTags(value) {
  return String(value || '')
    .split(/[、,，;；|/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildKnowledgeErrorCounts(rows) {
  const counts = {};
  rows.forEach(row => {
    const rawTag = String(row.knowledge_tag || '').trim();
    const tags = rawTag ? [rawTag, ...splitKnowledgeTags(rawTag)] : [];
    [...new Set(tags)].forEach(tag => {
      const key = normalizeKnowledgeKey(tag);
      if (key) counts[key] = (counts[key] || 0) + 1;
    });
  });
  return counts;
}

function getKnowledgeErrorCount(knowledge, knowledgeErrorCounts) {
  const key = normalizeKnowledgeKey(knowledge);
  if (!key || !Object.prototype.hasOwnProperty.call(knowledgeErrorCounts || {}, key)) return null;
  return knowledgeErrorCounts[key];
}

async function getCurrentKnowledgeErrorCounts(db, userId) {
  const rows = await db.all(`
    SELECT q.knowledge_tag
    FROM wrong_questions wq
    JOIN questions q ON q.id = wq.question_id
    ${ACTIVE_WRONG_ANSWER_JOIN}
    WHERE wq.user_id = ?
      AND a.id IS NOT NULL
      AND COALESCE(a.is_correct, 0) = 0
      AND COALESCE(a.selected, '') <> q.answer
  `, userId);
  return buildKnowledgeErrorCounts(rows);
}

async function recordAiBadcase(db, payload) {
  try {
    await db.run(
      `INSERT INTO ai_badcases (
        user_id, target_type, target_id, rating, reason, note, user_note,
        source, issue_type, severity, prompt_version, skill_version, status, context_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      payload.userId || 0,
      payload.targetType,
      Number(payload.targetId || 0),
      payload.rating || 'system_failure',
      payload.reason || '',
      payload.note || '',
      payload.userNote || '',
      payload.source || 'system_failure',
      payload.issueType || 'model_failure',
      payload.severity || 'medium',
      payload.promptVersion || '',
      payload.skillVersion || '',
      payload.status || 'unprocessed',
      JSON.stringify(payload.context || {})
    );
  } catch (err) {
    console.error('AI badcase record failed:', err);
  }
}

async function cleanupUserResolvedWrongs(db, userId) {
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
  `, userId);
}

function buildExtractPrompt(questions, type) {
  if (type === 'wrong') {
    return buildWrongExtractPrompt(questions);
  }

  const mode = type === 'all' ? 'all question-bank items' : 'wrong-answer items';
  const questionText = questions.map((q, idx) => {
    const opts = q.options || {};
    const optionLines = Object.keys(opts).sort().map(k => `${k}. ${opts[k]}`).join('  ');
    return [
      `${idx + 1}. [${q.type || 'single choice'}] ${q.stem}`,
      `Options: ${optionLines}`,
      `Answer: ${q.answer || ''}`,
      `Analysis: ${q.analysis || ''}`,
      `Wrong analysis: ${q.wrong_analysis || ''}`,
      `Knowledge review: ${q.knowledge_review || ''}`,
      `Knowledge tag: ${q.knowledge_tag || ''}`
    ].join('\n');
  }).join('\n\n');

  return [
    `Please generate a concise Simplified Chinese exam-review guide for ${mode}.`,
    'Output Markdown tables only. Do not add prose outside tables.',
    'Group rows by knowledge point. Keep each cell short and mobile-readable.',
    'Table columns must be: KaoDian | Key Content | Easy Mistake.',
    '',
    questionText
  ].join('\n');
}

function loadWrongExtractPrompt() {
  return fs.readFileSync(WRONG_EXTRACT_PROMPT_PATH, 'utf8').trim();
}

function formatOptions(options) {
  const opts = options && typeof options === 'object' ? options : {};
  return Object.keys(opts)
    .sort()
    .map(key => `${key}. ${opts[key]}`)
    .join('\n');
}

function buildWrongExtractPrompt(questions) {
  const questionText = questions.map(q => ([
    `题号：${q.id}`,
    `题干：${q.stem || ''}`,
    `选项：\n${formatOptions(q.options)}`,
    `正确答案：${q.answer || ''}`,
    `解题思路：${q.analysis || ''}`,
    `错误选项辨析：${q.wrong_analysis || ''}`,
    `知识点回顾：${q.knowledge_review || ''}`,
    `知识点标签：${q.knowledge_tag || ''}`
  ].join('\n'))).join('\n\n---\n\n');

  return [
    loadWrongExtractPrompt(),
    '',
    '# 附件内容：错题集全部题目',
    '',
    '以下内容为当前用户错题集里的全部有效错题，仅包含 A-H 字段：题号、题干、选项、正确答案、解题思路、错误选项辨析、知识点回顾、知识点标签。',
    '请严格基于这些真实输入生成 Markdown，不要编造未提供的题目或知识点。',
    '',
    questionText
  ].join('\n');
}

function normalizeDiagnosis(raw, meta) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const weakPoints = Array.isArray(obj.weak_points) ? obj.weak_points : [];
  const errorTypes = Array.isArray(obj.error_types) ? obj.error_types : [];
  const studyPlan = Array.isArray(obj.study_plan) ? obj.study_plan : [];
  const nextActions = Array.isArray(obj.next_actions) ? obj.next_actions : [];
  const qualityNotes = Array.isArray(obj.quality_notes) ? obj.quality_notes : [];

  const seenKnowledge = new Set();
  const normalizedWeakPoints = weakPoints
    .map(item => {
      const knowledge = String(item.knowledge || item.name || '').trim();
      return {
        knowledge,
        error_count: getKnowledgeErrorCount(knowledge, meta.knowledgeErrorCounts),
        risk_level: ['high', 'medium', 'low'].includes(item.risk_level) ? item.risk_level : 'medium',
        reason: String(item.reason || '请结合对应错题查看原因。')
      };
    })
    .filter(item => {
      const key = normalizeKnowledgeKey(item.knowledge);
      if (!key || seenKnowledge.has(key)) return false;
      seenKnowledge.add(key);
      return true;
    })
    .slice(0, 5);

  return {
    version: 'v1.3',
    prompt_version: DIAGNOSIS_PROMPT_VERSION,
    skill_version: DIAGNOSIS_SKILL_VERSION,
    title: String(obj.title || 'AI错题诊断报告'),
    summary: String(obj.summary || '已基于真实错题生成学习诊断，部分结论建议复核。'),
    wrong_total: meta.wrongTotal,
    analyzed_count: meta.analyzedCount,
    wrong_count: meta.analyzedCount,
    weak_points: normalizedWeakPoints,
    error_types: errorTypes.slice(0, 5).map(item => ({
      type: String(item.type || item.name || 'knowledge_blank'),
      label: String(item.label || item.type || '知识缺口'),
      description: String(item.description || item.reason || '该错误类型需要结合错题进一步复核。')
    })),
    study_plan: studyPlan.slice(0, 6).map(item => String(item)),
    next_actions: nextActions.slice(0, 5).map(item => String(item)),
    quality_notes: qualityNotes.slice(0, 5).map(item => String(item)),
    created_at: new Date().toISOString(),
    created_at_shanghai: shanghaiNow()
  };
}

function applyCurrentKnowledgeErrorCounts(content, knowledgeErrorCounts) {
  const source = content && typeof content === 'object' ? content : {};
  const weakPoints = Array.isArray(source.weak_points) ? source.weak_points : [];
  return {
    ...source,
    weak_points: weakPoints.map(item => ({
      ...item,
      error_count: getKnowledgeErrorCount(item.knowledge, knowledgeErrorCounts)
    }))
  };
}

function serializeDiagnosisReport(row, knowledgeErrorCounts) {
  const content = applyCurrentKnowledgeErrorCounts(safeJsonParse(row.content_json, {}), knowledgeErrorCounts);
  return {
    id: row.id,
    report_no: row.report_no || row.id,
    wrong_count: row.analyzed_count || row.wrong_count,
    wrong_total: row.wrong_total || row.wrong_count,
    analyzed_count: row.analyzed_count || row.wrong_count,
    content,
    created_at: row.created_at,
    created_at_shanghai: content.created_at_shanghai || formatShanghaiDateTime(row.created_at)
  };
}

function getWeakPracticeTargets(reportContent) {
  const seen = new Set();
  return (Array.isArray(reportContent?.weak_points) ? reportContent.weak_points : [])
    .map(item => String(item?.knowledge || '').trim())
    .filter(knowledge => {
      const key = normalizeKnowledgeKey(knowledge);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function formatWeakPracticeSource(rows) {
  return rows.map((row, index) => {
    const options = safeJsonParse(row.options, {});
    return [
      `错题 ${index + 1}`,
      `题号：${row.question_id}`,
      `题干：${row.stem || ''}`,
      `选项：${formatOptions(options)}`,
      `正确答案：${row.answer || ''}`,
      `用户错误选项：${row.selected || ''}`,
      `解题思路：${row.analysis || ''}`,
      `错误选项辨析：${row.wrong_analysis || ''}`,
      `知识点回顾：${row.knowledge_review || ''}`,
      `知识点标签：${row.knowledge_tag || ''}`
    ].join('\n');
  }).join('\n\n---\n\n');
}

function buildWeakPracticePrompt(reportContent, sourceRows) {
  const targets = getWeakPracticeTargets(reportContent);
  const targetText = targets.map((knowledge, index) => `${index + 1}. ${knowledge}`).join('\n');
  return [
    '你是“独家题库”的 AI 薄弱新题生成 Skill。',
    '请严格基于本份 AI 错题诊断报告和用户真实错题，生成可直接作答的全新单选题。',
    '每个指定薄弱知识点必须恰好生成 3 道题，不得遗漏、合并、替换或新增知识点。',
    '所有题目必须是新题，不能复用输入错题的题干、选项组合或正确答案表述。',
    '每题必须有 A、B、C、D 四个互斥选项，且只有一个正确答案；解析要解释为什么正确。',
    '只输出一个合法 JSON 对象，不要输出 Markdown、代码块或任何额外说明。',
    '',
    '输出结构必须严格如下：',
    '{',
    '  "title": "AI薄弱新题",',
    '  "intro": "一句中文练习说明",',
    '  "knowledge_sets": [',
    '    {',
    '      "knowledge": "必须逐字使用指定薄弱知识点",',
    '      "questions": [',
    '        {',
    '          "stem": "题干",',
    '          "options": {"A":"选项A","B":"选项B","C":"选项C","D":"选项D"},',
    '          "answer": "A",',
    '          "analysis": "中文解析",',
    '          "knowledge_tag": "必须逐字使用本组知识点"',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    '【本份诊断报告的指定薄弱知识点】',
    targetText,
    '',
    '【诊断摘要】',
    String(reportContent?.summary || '无'),
    '',
    '【真实错题输入】',
    formatWeakPracticeSource(sourceRows)
  ].join('\n');
}

function buildWeakPracticeReviewPrompt(content, reportContent) {
  const targets = getWeakPracticeTargets(reportContent);
  return [
    '你是“独家题库”的 AI 出题审核 Skill。',
    '请审核以下 AI 薄弱新题是否适合直接给用户作答。',
    '审核维度：每个指定知识点恰好 3 道题、每题只有一个正确答案、四个选项互斥、题干与解析一致、题目没有复用用户输入错题。',
    '只输出一个合法 JSON 对象，不要输出 Markdown 或额外说明。',
    '输出格式：{\"approved\":true,\"issues\":[]}。',
    '只有全部通过时 approved 才能为 true；issues 最多 5 条中文短句。',
    '',
    '【指定知识点】',
    targets.join('\n'),
    '',
    '【待审核新题】',
    JSON.stringify(content)
  ].join('\n');
}

function normalizeWeakPractice(raw, reportContent) {
  const targets = getWeakPracticeTargets(reportContent);
  if (!targets.length) throw new Error('该诊断报告没有可用于出题的薄弱知识点');

  const sourceSets = Array.isArray(raw?.knowledge_sets) ? raw.knowledge_sets : [];
  const sourceByKnowledge = new Map(
    sourceSets.map(item => [normalizeKnowledgeKey(item?.knowledge), item])
  );

  const knowledgeSets = targets.map(knowledge => {
    const source = sourceByKnowledge.get(normalizeKnowledgeKey(knowledge));
    const questions = Array.isArray(source?.questions) ? source.questions : [];
    if (questions.length !== 3) {
      throw new Error(`知识点“${knowledge}”未生成恰好 3 道题`);
    }

    return {
      knowledge,
      questions: questions.map((item, index) => {
        const options = item?.options && typeof item.options === 'object' ? item.options : {};
        const normalizedOptions = {};
        ['A', 'B', 'C', 'D'].forEach(key => {
          normalizedOptions[key] = String(options[key] || '').trim();
        });
        const answer = String(item?.answer || '').trim().toUpperCase();
        if (!String(item?.stem || '').trim() || !String(item?.analysis || '').trim() ||
          ['A', 'B', 'C', 'D'].some(key => !normalizedOptions[key]) || !['A', 'B', 'C', 'D'].includes(answer)) {
          throw new Error(`知识点“${knowledge}”第 ${index + 1} 题格式不完整`);
        }
        return {
          stem: String(item.stem).trim(),
          options: normalizedOptions,
          answer,
          analysis: String(item.analysis).trim(),
          knowledge_tag: knowledge
        };
      })
    };
  });

  return {
    title: String(raw?.title || 'AI薄弱新题').trim() || 'AI薄弱新题',
    intro: String(raw?.intro || '每个薄弱知识点 3 道新题，完成后查看即时解析。').trim(),
    knowledge_sets: knowledgeSets
  };
}

function flatWeakPracticeQuestions(content) {
  const result = [];
  (Array.isArray(content?.knowledge_sets) ? content.knowledge_sets : []).forEach((set, setIndex) => {
    (Array.isArray(set?.questions) ? set.questions : []).forEach((question, questionIndex) => {
      result.push({ ...question, knowledge: set.knowledge, set_index: setIndex, question_index: questionIndex });
    });
  });
  return result;
}

async function serializeWeakPracticeSet(db, row) {
  if (!row) return null;
  const content = safeJsonParse(row.content_json, {});
  const answers = await db.all(
    `SELECT question_index, selected, is_correct, created_at
     FROM ai_weak_practice_answers
     WHERE practice_set_id = ?
     ORDER BY question_index ASC`,
    row.id
  );
  const questionTotal = flatWeakPracticeQuestions(content).length;
  const answeredCount = answers.length;
  return {
    id: row.id,
    diagnosis_report_id: row.diagnosis_report_id,
    status: row.status,
    price_cents: row.price_cents,
    title: row.title || content.title || 'AI薄弱新题',
    intro: row.intro || content.intro || '',
    content,
    answers,
    question_total: questionTotal,
    answered_count: answeredCount,
    correct_count: answers.filter(answer => Number(answer.is_correct) === 1).length,
    created_at: row.created_at,
    created_at_shanghai: formatShanghaiDateTime(row.created_at),
    completed_at: row.completed_at,
    completed_at_shanghai: row.completed_at ? formatShanghaiDateTime(row.completed_at) : null
  };
}

function buildWrongDiagnosisPrompt(payload) {
  const wrongText = payload.wrongs.map((item, idx) => {
    const q = item.question;
    const opts = q.options || {};
    const optionLines = Object.keys(opts).sort().map(k => `${k}. ${opts[k]}`).join('\n');
    return [
      `第 ${idx + 1} 题`,
      `题号：${q.id}`,
      `题干：${q.stem}`,
      `选项：\n${optionLines}`,
      `正确答案：${q.answer}`,
      `解题思路：${q.analysis || ''}`,
      `错误选项辨析：${q.wrong_analysis || ''}`,
      `知识点回顾：${q.knowledge_review || ''}`,
      `知识点标签：${q.knowledge_tag || ''}`,
      `用户选择的错误选项：${item.selected || ''}`
    ].join('\n');
  }).join('\n\n');

  return [
    '你是“独家题库”的 AI 错题诊断 Skill。',
    '请根据用户真实错题记录生成学习诊断报告。',
    '只能分析输入中提供的错题，不得编造题目、知识点或用户选择的错误选项。',
    '薄弱知识点名称必须逐字使用错题明细中的“知识点标签”，不要改写、合并或新建标签。',
    '如果某个字段证据不足，必须明确说明“证据不足”，不能用兜底数字假装确定。',
    '输出必须是一个合法 JSON 对象，不要输出 Markdown，不要输出 JSON 以外的解释。',
    '',
    `【本次实时错题集】共 ${payload.analyzedCount} 道错题。`,
    '',
    '【错题明细】',
    wrongText,
    '',
    '【输出要求】',
    '请只输出一个合法 JSON 对象，字段如下：',
    '{',
    '  "title": "报告标题，简体中文",',
    '  "summary": "一句话总结用户当前最主要的学习问题",',
    '  "weak_points": [',
    '    { "knowledge": "错题明细中的知识点标签原文", "risk_level": "high|medium|low", "reason": "为什么判断这是薄弱点，必须引用错题明细中的证据" }',
    '  ],',
    '  "error_types": [',
    '    { "type": "concept_confusion|careless_reading|memory_gap|rule_misuse|knowledge_blank", "label": "错误类型中文名称", "description": "错误类型说明，必须结合错题表现" }',
    '  ],',
    '  "study_plan": ["3 到 6 条具体复习动作"],',
    '  "next_actions": ["2 到 5 条下一步刷题或复盘动作"],',
    '  "quality_notes": ["数据不足、证据限制或需要人工复核的说明；没有则输出空数组"]',
    '}',
    '',
    '【分析规则】',
    '1. weak_points 最多输出 5 个，并按风险从高到低排序。',
    '2. 不要输出泛泛鼓励，例如“继续努力”“保持学习”。',
    '3. study_plan 必须是用户下一步能执行的动作。',
    '4. 如果错题数量少于 3 道，报告要降低结论强度，并在 quality_notes 中说明样本不足。'
  ].join('\n');
}

async function callAi(messages, extra = {}) {
  const response = await fetchWithRetry(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify(aiPayload(messages, extra))
  });
  return response.json();
}

router.post('/extract', auth, async (req, res) => {
  const { type } = req.body;
  const db = await getDb();
  await cleanupUserResolvedWrongs(db, req.userId);

  let p = await db.get('SELECT * FROM purchases WHERE user_id = ?', req.userId);
  if (!p) return res.status(403).json({ error: 'No purchase record' });

  if (type === 'all' && p.knowledge_all !== 1) {
    return res.status(403).json({ error: 'Knowledge collection is locked' });
  }
  if (type === 'wrong' && p.ai_extract_count < 1) {
    await db.run('UPDATE purchases SET ai_extract_count = ai_extract_count + 1 WHERE user_id = ?', req.userId);
    p = await db.get('SELECT * FROM purchases WHERE user_id = ?', req.userId);
  }

  let questions = [];
  if (type === 'all') {
    questions = await db.all('SELECT * FROM questions ORDER BY id');
  } else {
    const wrongIds = await db.all(`
      SELECT wq.question_id
      FROM wrong_questions wq
      JOIN questions q ON q.id = wq.question_id
      ${ACTIVE_WRONG_ANSWER_JOIN}
      WHERE wq.user_id = ?
        AND a.id IS NOT NULL
        AND COALESCE(a.is_correct, 0) = 0
        AND COALESCE(a.selected, '') <> q.answer
      ORDER BY wq.question_id ASC
    `, req.userId);
    for (const row of wrongIds) {
      const q = await db.get('SELECT * FROM questions WHERE id = ?', row.question_id);
      if (q) questions.push(q);
    }
  }

  if (questions.length === 0) {
    return res.status(400).json({ error: 'No questions to extract' });
  }
  if (!AI_API_KEY) {
    return res.status(500).json({ error: 'AI API key is not configured' });
  }

  questions = questions.map(q => ({ ...q, options: safeJsonParse(q.options, {}) }));

  try {
    const messages = type === 'wrong'
      ? [
        { role: 'system', content: '你是严格执行提示词的考试辅导助手。必须输出 Markdown。' },
        { role: 'user', content: buildExtractPrompt(questions, type) }
      ]
      : [
        { role: 'system', content: 'You are an exam-prep tutor. Answer in Simplified Chinese.' },
        { role: 'user', content: buildExtractPrompt(questions, type) }
      ];
    const requestOptions = type === 'wrong'
      ? { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
      : {};
    const data = await callAi(messages, requestOptions);

    const content = data.choices?.[0]?.message?.content || '';
    if (!content || !content.trim()) {
      throw new Error('AI returned empty content');
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
      content,
      created_at_shanghai: shanghaiNow()
    });
  } catch (err) {
    console.error('AI extract error:', err);
    await recordAiBadcase(db, {
      userId: req.userId,
      targetType: type === 'all' ? 'extract_all' : 'extract_wrong',
      targetId: 0,
      rating: 'system_failure',
      reason: err.message,
      note: 'AI提炼生成失败，未创建提炼报告。',
      source: 'system_failure',
      issueType: err.message && err.message.includes('JSON') ? 'invalid_json' : 'model_failure',
      severity: 'high',
      promptVersion: EXTRACT_PROMPT_VERSION,
      skillVersion: EXTRACT_SKILL_VERSION,
      context: {
        type,
        question_count: questions.length,
        input_fields: ['题号', '题干', '选项', '正确答案', '解题思路', '错误选项辨析', '知识点回顾', '知识点标签']
      }
    });
    res.status(500).json({ error: 'AI extract failed: ' + err.message });
  }
});

async function createDiagnosisReport(db, userId) {
  await cleanupUserResolvedWrongs(db, userId);
  const totalWrongRow = await db.get(
    `SELECT COUNT(*) as total
    FROM wrong_questions wq
    JOIN questions q ON q.id = wq.question_id
    ${ACTIVE_WRONG_ANSWER_JOIN}
    WHERE wq.user_id = ?
      AND a.id IS NOT NULL
      AND COALESCE(a.is_correct, 0) = 0
      AND COALESCE(a.selected, '') <> q.answer`,
    userId
  );
  const wrongTotal = Number(totalWrongRow?.total || 0);
  const knowledgeErrorCounts = await getCurrentKnowledgeErrorCounts(db, userId);

  const rows = await db.all(`
    SELECT
      wq.question_id,
      wq.count,
      wq.last_wrong_at,
      a.selected,
      q.type,
      q.stem,
      q.options,
      q.answer,
      q.analysis,
      q.wrong_analysis,
      q.knowledge_review,
      q.knowledge_tag
    FROM wrong_questions wq
    JOIN questions q ON wq.question_id = q.id
    ${ACTIVE_WRONG_ANSWER_JOIN}
    WHERE wq.user_id = ?
      AND a.id IS NOT NULL
      AND COALESCE(a.is_correct, 0) = 0
      AND COALESCE(a.selected, '') <> q.answer
    ORDER BY wq.count DESC, wq.last_wrong_at DESC
    LIMIT ?
  `, userId, DIAGNOSIS_MAX_WRONGS);

  if (rows.length === 0) {
    const err = new Error('No wrong questions yet');
    err.status = 400;
    throw err;
  }
  if (!AI_API_KEY) {
    await recordAiBadcase(db, {
      userId,
      targetType: 'diagnosis',
      targetId: 0,
      rating: 'system_failure',
      reason: 'AI API key is not configured',
      note: 'AI诊断未创建报告。',
      source: 'system_failure',
      issueType: 'model_failure',
      severity: 'high',
      promptVersion: DIAGNOSIS_PROMPT_VERSION,
      skillVersion: DIAGNOSIS_SKILL_VERSION,
      context: { wrong_total: wrongTotal, analyzed_count: rows.length }
    });
    throw new Error('AI API key is not configured');
  }

  const wrongs = rows.map(row => ({
    count: row.count,
    last_wrong_at: row.last_wrong_at,
    selected: row.selected,
    question: {
      id: row.question_id,
      type: row.type,
      stem: row.stem,
      options: safeJsonParse(row.options, {}),
      answer: row.answer,
      analysis: row.analysis,
      wrong_analysis: row.wrong_analysis,
      knowledge_review: row.knowledge_review,
      knowledge_tag: row.knowledge_tag
    }
  }));

  const meta = {
    wrongTotal,
    analyzedCount: rows.length,
    knowledgeErrorCounts
  };

  try {
    const data = await callAi([
      { role: 'system', content: 'You are a strict JSON-only AI diagnosis skill.' },
      { role: 'user', content: buildWrongDiagnosisPrompt({ ...meta, wrongs }) }
    ], {
      response_format: { type: 'json_object' }
    });

    const content = data.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(content);
    const diagnosis = normalizeDiagnosis(parsed, meta);
    const latest = await db.get(
      'SELECT MAX(report_no) as max_no FROM ai_diagnosis_reports WHERE user_id = ?',
      userId
    );
    const reportNo = Number(latest?.max_no || 0) + 1;

    const result = await db.run(
      `INSERT INTO ai_diagnosis_reports (
        user_id, report_no, wrong_count, wrong_total, analyzed_count, total_answered, accuracy, content_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      reportNo,
      meta.analyzedCount,
      meta.wrongTotal,
      meta.analyzedCount,
      0,
      0,
      JSON.stringify(diagnosis)
    );

    return {
      id: result.lastID,
      report_no: reportNo,
      wrong_count: meta.analyzedCount,
      wrong_total: meta.wrongTotal,
      analyzed_count: meta.analyzedCount,
      content: diagnosis,
      created_at: diagnosis.created_at,
      created_at_shanghai: diagnosis.created_at_shanghai
    };
  } catch (err) {
    console.error('AI diagnosis error:', err);
    await recordAiBadcase(db, {
      userId,
      targetType: 'diagnosis',
      targetId: 0,
      rating: 'system_failure',
      reason: err.message,
      note: 'AI诊断生成失败，未创建报告。',
      source: 'system_failure',
      issueType: err.message && err.message.toLowerCase().includes('json') ? 'invalid_json' : 'model_failure',
      severity: 'high',
      promptVersion: DIAGNOSIS_PROMPT_VERSION,
      skillVersion: DIAGNOSIS_SKILL_VERSION,
      context: {
        wrong_total: meta.wrongTotal,
        analyzed_count: meta.analyzedCount,
        knowledge_error_counts: meta.knowledgeErrorCounts
      }
    });
    throw err;
  }
}

async function runDiagnosisJob(jobId, userId) {
  const db = await getDb();
  try {
    await db.run(
      "UPDATE ai_diagnosis_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      jobId,
      userId
    );
    const report = await createDiagnosisReport(db, userId);
    await db.run(
      "UPDATE ai_diagnosis_jobs SET status = 'completed', report_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      report.id,
      jobId,
      userId
    );
  } catch (err) {
    await db.run(
      "UPDATE ai_diagnosis_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      err.message || 'AI diagnosis failed',
      jobId,
      userId
    );
  }
}

async function createWeakPracticeContent(db, userId, reportId) {
  const report = await db.get(
    'SELECT id, content_json FROM ai_diagnosis_reports WHERE id = ? AND user_id = ?',
    reportId,
    userId
  );
  if (!report) {
    const err = new Error('诊断报告不存在');
    err.status = 404;
    throw err;
  }
  if (!AI_API_KEY) throw new Error('AI API key is not configured');

  const reportContent = safeJsonParse(report.content_json, {});
  if (!getWeakPracticeTargets(reportContent).length) {
    const err = new Error('该诊断报告暂无可用于出题的薄弱知识点');
    err.status = 400;
    throw err;
  }

  const sourceRows = await db.all(`
    SELECT
      wq.question_id,
      wq.count,
      a.selected,
      q.stem,
      q.options,
      q.answer,
      q.analysis,
      q.wrong_analysis,
      q.knowledge_review,
      q.knowledge_tag
    FROM wrong_questions wq
    JOIN questions q ON q.id = wq.question_id
    ${ACTIVE_WRONG_ANSWER_JOIN}
    WHERE wq.user_id = ?
      AND a.id IS NOT NULL
      AND COALESCE(a.is_correct, 0) = 0
      AND COALESCE(a.selected, '') <> q.answer
    ORDER BY wq.count DESC, wq.last_wrong_at DESC
    LIMIT ?
  `, userId, DIAGNOSIS_MAX_WRONGS);

  let lastReviewIssues = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await callAi([
      { role: 'system', content: '你是严格 JSON 输出的 AI 出题 Skill。' },
      { role: 'user', content: buildWeakPracticePrompt(reportContent, sourceRows) }
    ], {
      response_format: { type: 'json_object' }
    });
    const content = data.choices?.[0]?.message?.content || '';
    const generated = normalizeWeakPractice(extractJsonObject(content), reportContent);

    const reviewData = await callAi([
      { role: 'system', content: '你是严格 JSON 输出的 AI 出题审核 Skill。' },
      { role: 'user', content: buildWeakPracticeReviewPrompt(generated, reportContent) }
    ], {
      response_format: { type: 'json_object' }
    });
    const reviewContent = reviewData.choices?.[0]?.message?.content || '';
    const review = extractJsonObject(reviewContent);
    if (review?.approved === true) {
      return {
        ...generated,
        review: {
          status: 'approved',
          skill_version: WEAK_PRACTICE_REVIEW_SKILL_VERSION
        }
      };
    }
    lastReviewIssues = Array.isArray(review?.issues) ? review.issues.slice(0, 5) : [];
  }
  throw new Error('AI出题审核未通过：' + (lastReviewIssues.join('；') || '请稍后重试'));
}

async function runWeakPracticeJob(jobId, practiceSetId, userId, reportId) {
  const db = await getDb();
  try {
    await db.run(
      "UPDATE ai_weak_practice_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      jobId,
      userId
    );
    const content = await createWeakPracticeContent(db, userId, reportId);
    await db.run(
      `UPDATE ai_weak_practice_sets
       SET status = 'ready', title = ?, intro = ?, content_json = ?
       WHERE id = ? AND user_id = ?`,
      content.title,
      content.intro,
      JSON.stringify(content),
      practiceSetId,
      userId
    );
    await db.run(
      "UPDATE ai_weak_practice_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      jobId,
      userId
    );
  } catch (err) {
    await db.run(
      "UPDATE ai_weak_practice_sets SET status = 'failed' WHERE id = ? AND user_id = ?",
      practiceSetId,
      userId
    );
    await db.run(
      "UPDATE ai_weak_practice_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      err.message || 'AI weak practice generation failed',
      jobId,
      userId
    );
  }
}

router.post('/diagnosis', auth, async (req, res) => {
  const db = await getDb();

  if (req.query.sync === '1') {
    try {
      return res.json(await createDiagnosisReport(db, req.userId));
    } catch (err) {
      return res.status(err.status || 500).json({ error: 'AI diagnosis failed: ' + err.message });
    }
  }

  const job = await db.run(
    "INSERT INTO ai_diagnosis_jobs (user_id, status) VALUES (?, 'pending')",
    req.userId
  );
  setImmediate(() => runDiagnosisJob(job.lastID, req.userId));
  res.status(202).json({ job_id: job.lastID, status: 'pending' });
});

router.get('/diagnosis/jobs/:id', auth, async (req, res) => {
  const db = await getDb();
  const job = await db.get(
    'SELECT id, status, report_id, error, created_at, updated_at FROM ai_diagnosis_jobs WHERE id = ? AND user_id = ?',
    req.params.id,
    req.userId
  );
  if (!job) return res.status(404).json({ error: 'Diagnosis job not found' });

  let report = null;
  if (job.report_id) {
    const knowledgeErrorCounts = await getCurrentKnowledgeErrorCounts(db, req.userId);
    const row = await db.get(
      `SELECT id, report_no, wrong_count, wrong_total, analyzed_count, total_answered, accuracy, content_json, created_at
      FROM ai_diagnosis_reports
      WHERE id = ? AND user_id = ?`,
      job.report_id,
      req.userId
    );
    if (row) report = serializeDiagnosisReport(row, knowledgeErrorCounts);
  }

  res.json({
    id: job.id,
    status: job.status,
    error: job.error,
    report,
    created_at: job.created_at,
    updated_at: job.updated_at
  });
});

router.get('/diagnosis', auth, async (req, res) => {
  const db = await getDb();
  const knowledgeErrorCounts = await getCurrentKnowledgeErrorCounts(db, req.userId);
  const rows = await db.all(
    `SELECT
      id, report_no, wrong_count, wrong_total, analyzed_count, total_answered, accuracy, content_json, created_at
    FROM ai_diagnosis_reports
    WHERE user_id = ?
    ORDER BY report_no DESC, id DESC`,
    req.userId
  );

  res.json({
    reports: rows.map(row => serializeDiagnosisReport(row, knowledgeErrorCounts))
  });
});

router.get('/diagnosis/:reportId/weak-practice', auth, async (req, res) => {
  const db = await getDb();
  const practice = await db.get(
    `SELECT id, user_id, diagnosis_report_id, status, price_cents, title, intro, content_json, created_at, completed_at
     FROM ai_weak_practice_sets
     WHERE diagnosis_report_id = ? AND user_id = ?`,
    Number(req.params.reportId),
    req.userId
  );
  if (!practice) return res.json({ practice: null, job: null });

  const job = await db.get(
    `SELECT id, status, error, created_at, updated_at
     FROM ai_weak_practice_jobs
     WHERE practice_set_id = ? AND user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    practice.id,
    req.userId
  );
  res.json({ practice: await serializeWeakPracticeSet(db, practice), job: job || null });
});

router.post('/diagnosis/:reportId/weak-practice', auth, async (req, res) => {
  const db = await getDb();
  const reportId = Number(req.params.reportId);
  const report = await db.get('SELECT id FROM ai_diagnosis_reports WHERE id = ? AND user_id = ?', reportId, req.userId);
  if (!report) return res.status(404).json({ error: '诊断报告不存在' });

  let practice = await db.get(
    `SELECT id, user_id, diagnosis_report_id, status, price_cents, title, intro, content_json, created_at, completed_at
     FROM ai_weak_practice_sets
     WHERE diagnosis_report_id = ? AND user_id = ?`,
    reportId,
    req.userId
  );

  if (practice && ['ready', 'completed'].includes(practice.status)) {
    return res.json({ practice: await serializeWeakPracticeSet(db, practice), already_generated: true });
  }

  if (practice && practice.status === 'generating') {
    const activeJob = await db.get(
      `SELECT id, status FROM ai_weak_practice_jobs
       WHERE practice_set_id = ? AND user_id = ? AND status IN ('pending', 'running')
       ORDER BY id DESC LIMIT 1`,
      practice.id,
      req.userId
    );
    if (activeJob) return res.status(202).json({ job_id: activeJob.id, status: activeJob.status, practice_set_id: practice.id });
  }

  if (practice) {
    await db.run(
      `UPDATE ai_weak_practice_sets
       SET status = 'generating', title = NULL, intro = NULL, content_json = NULL, completed_at = NULL
       WHERE id = ? AND user_id = ?`,
      practice.id,
      req.userId
    );
  } else {
    const result = await db.run(
      `INSERT INTO ai_weak_practice_sets (user_id, diagnosis_report_id, status, price_cents)
       VALUES (?, ?, 'generating', 990)`,
      req.userId,
      reportId
    );
    practice = await db.get(
      `SELECT id, user_id, diagnosis_report_id, status, price_cents, title, intro, content_json, created_at, completed_at
       FROM ai_weak_practice_sets WHERE id = ?`,
      result.lastID
    );
  }

  const job = await db.run(
    "INSERT INTO ai_weak_practice_jobs (user_id, practice_set_id, status) VALUES (?, ?, 'pending')",
    req.userId,
    practice.id
  );
  setImmediate(() => runWeakPracticeJob(job.lastID, practice.id, req.userId, reportId));
  res.status(202).json({ job_id: job.lastID, status: 'pending', practice_set_id: practice.id, price_cents: 990 });
});

router.get('/weak-practice/jobs/:id', auth, async (req, res) => {
  const db = await getDb();
  const job = await db.get(
    `SELECT id, practice_set_id, status, error, created_at, updated_at
     FROM ai_weak_practice_jobs
     WHERE id = ? AND user_id = ?`,
    Number(req.params.id),
    req.userId
  );
  if (!job) return res.status(404).json({ error: 'AI薄弱新题任务不存在' });
  const practice = await db.get(
    `SELECT id, user_id, diagnosis_report_id, status, price_cents, title, intro, content_json, created_at, completed_at
     FROM ai_weak_practice_sets WHERE id = ? AND user_id = ?`,
    job.practice_set_id,
    req.userId
  );
  res.json({
    ...job,
    practice: practice ? await serializeWeakPracticeSet(db, practice) : null
  });
});

router.post('/weak-practice/:id/answers', auth, async (req, res) => {
  const db = await getDb();
  const practiceSetId = Number(req.params.id);
  const questionIndex = Number(req.body?.questionIndex);
  const selected = String(req.body?.selected || '').trim().toUpperCase();
  const practice = await db.get(
    `SELECT id, user_id, diagnosis_report_id, status, price_cents, title, intro, content_json, created_at, completed_at
     FROM ai_weak_practice_sets
     WHERE id = ? AND user_id = ?`,
    practiceSetId,
    req.userId
  );
  if (!practice) return res.status(404).json({ error: 'AI薄弱新题不存在' });
  if (!['ready', 'completed'].includes(practice.status)) {
    return res.status(409).json({ error: 'AI薄弱新题尚未生成完成' });
  }

  const questions = flatWeakPracticeQuestions(safeJsonParse(practice.content_json, {}));
  const question = questions[questionIndex];
  if (!Number.isInteger(questionIndex) || !question) return res.status(400).json({ error: '题目不存在' });
  if (!Object.prototype.hasOwnProperty.call(question.options || {}, selected)) {
    return res.status(400).json({ error: '请选择有效选项' });
  }

  const existing = await db.get(
    'SELECT id FROM ai_weak_practice_answers WHERE practice_set_id = ? AND question_index = ?',
    practiceSetId,
    questionIndex
  );
  if (existing) return res.status(409).json({ error: '本题已经作答，不能修改答案' });

  const isCorrect = selected === question.answer;
  await db.run(
    `INSERT INTO ai_weak_practice_answers (practice_set_id, question_index, selected, is_correct)
     VALUES (?, ?, ?, ?)`,
    practiceSetId,
    questionIndex,
    selected,
    isCorrect ? 1 : 0
  );
  const answerCount = await db.get(
    'SELECT COUNT(*) AS total FROM ai_weak_practice_answers WHERE practice_set_id = ?',
    practiceSetId
  );
  if (Number(answerCount?.total || 0) >= questions.length) {
    await db.run(
      "UPDATE ai_weak_practice_sets SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
      practiceSetId
    );
  }

  const updated = await db.get(
    `SELECT id, user_id, diagnosis_report_id, status, price_cents, title, intro, content_json, created_at, completed_at
     FROM ai_weak_practice_sets WHERE id = ? AND user_id = ?`,
    practiceSetId,
    req.userId
  );
  res.json({
    is_correct: isCorrect,
    correct_answer: question.answer,
    analysis: question.analysis,
    practice: await serializeWeakPracticeSet(db, updated)
  });
});

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows) {
  const headers = [
    ['badcase_id', 'Badcase编号'],
    ['created_at_shanghai', '发生时间(上海)'],
    ['username', '用户账号'],
    ['source', '来源'],
    ['target_type', 'AI场景'],
    ['rating', '反馈结果'],
    ['severity', '严重程度'],
    ['user_note', '用户说明'],
    ['status', '处理状态'],
    ['target_id', '目标ID']
  ];
  const lines = [headers.map(([, label]) => csvEscape(label)).join(',')];
  rows.forEach(row => {
    lines.push(headers.map(([key]) => csvEscape(row[key])).join(','));
  });
  return '\uFEFF' + lines.join('\r\n');
}

router.get('/badcases', auth, requireAdmin, async (req, res) => {
  const db = await getDb();
  const targetType = req.query.targetType ? String(req.query.targetType) : '';
  const params = [];
  let where = '';
  if (targetType) {
    where = 'WHERE bc.target_type = ?';
    params.push(targetType);
  }
  const rows = await db.all(
    `SELECT
      bc.id, bc.user_id, u.username, bc.target_type, bc.target_id, bc.rating, bc.reason, bc.note,
      bc.user_note, bc.source, bc.issue_type, bc.severity, bc.prompt_version, bc.skill_version,
      bc.status, bc.context_json, bc.created_at
    FROM ai_badcases bc
    LEFT JOIN users u ON u.id = bc.user_id
    ${where}
    ORDER BY bc.created_at DESC, bc.id DESC`,
    ...params
  );
  res.json({
    badcases: rows.map(row => ({
      ...row,
      badcase_id: `BC-V13-${String(row.id).padStart(4, '0')}`,
      created_at_shanghai: formatShanghaiDateTime(row.created_at)
    }))
  });
});

router.get('/badcases/export', auth, requireAdmin, async (req, res) => {
  const db = await getDb();
  const targetType = req.query.targetType ? String(req.query.targetType) : '';
  const params = [];
  let where = '';
  if (targetType) {
    where = 'WHERE bc.target_type = ?';
    params.push(targetType);
  }
  const rows = await db.all(
    `SELECT
      bc.id, bc.user_id, u.username, bc.target_type, bc.target_id, bc.rating, bc.reason, bc.note,
      bc.user_note, bc.source, bc.issue_type, bc.severity, bc.prompt_version, bc.skill_version,
      bc.status, bc.context_json, bc.created_at
    FROM ai_badcases bc
    LEFT JOIN users u ON u.id = bc.user_id
    ${where}
    ORDER BY bc.created_at DESC, bc.id DESC`,
    ...params
  );
  const exportRows = rows.map(row => ({
    ...row,
    badcase_id: `BC-V13-${String(row.id).padStart(4, '0')}`,
    created_at_shanghai: formatShanghaiDateTime(row.created_at)
  }));
  const suffix = targetType ? targetType : 'all';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="v1.3-badcases-${suffix}.csv"`);
  res.send(rowsToCsv(exportRows));
});

router.post('/badcases', auth, async (req, res) => {
  const db = await getDb();
  const { targetType, targetId, rating, userNote } = req.body || {};
  const allowedTypes = ['diagnosis', 'extract_wrong', 'extract_all'];
  const allowedRatings = ['usable', 'needs_fix', 'unusable', 'system_failure'];

  if (!allowedTypes.includes(targetType)) {
    return res.status(400).json({ error: 'Invalid feedback target type' });
  }
  if (!Number(targetId)) {
    return res.status(400).json({ error: 'Invalid feedback target id' });
  }
  if (!allowedRatings.includes(rating)) {
    return res.status(400).json({ error: 'Invalid feedback rating' });
  }
  const cleanUserNote = String(userNote || '').trim();
  if ((rating === 'needs_fix' || rating === 'unusable') && !cleanUserNote) {
    return res.status(400).json({ error: '需修改或不可用时必须填写文字说明' });
  }

  if (targetType === 'diagnosis') {
    const report = await db.get('SELECT id FROM ai_diagnosis_reports WHERE id = ? AND user_id = ?', Number(targetId), req.userId);
    if (!report) return res.status(404).json({ error: 'Diagnosis report not found' });
  }

  const result = await db.run(
    `INSERT INTO ai_badcases (
      user_id, target_type, target_id, rating, reason, note, user_note,
      source, issue_type, severity, prompt_version, skill_version, status, context_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.userId,
    targetType,
    Number(targetId),
    rating,
    rating,
    '',
    cleanUserNote,
    'user_feedback',
    rating === 'needs_fix' ? 'weak_reasoning' : rating === 'unusable' ? 'wrong_attribution' : 'user_positive',
    rating === 'unusable' ? 'high' : rating === 'needs_fix' ? 'medium' : 'low',
    targetType === 'diagnosis' ? DIAGNOSIS_PROMPT_VERSION : EXTRACT_PROMPT_VERSION,
    targetType === 'diagnosis' ? DIAGNOSIS_SKILL_VERSION : EXTRACT_SKILL_VERSION,
    'unprocessed',
    JSON.stringify({ source: 'front_feedback' })
  );

  res.json({ id: result.lastID, message: 'Feedback saved' });
});

router.patch('/badcases/:id', auth, requireAdmin, async (req, res) => {
  const db = await getDb();
  const status = String(req.body?.status || '');
  if (!['unprocessed', 'processed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid badcase status' });
  }
  const result = await db.run(
    'UPDATE ai_badcases SET status = ? WHERE id = ?',
    status,
    Number(req.params.id)
  );
  if (!result.changes) return res.status(404).json({ error: 'Badcase not found' });
  res.json({ id: Number(req.params.id), status });
});

router.delete('/badcases/:id', auth, requireAdmin, async (req, res) => {
  const db = await getDb();
  const result = await db.run(
    'DELETE FROM ai_badcases WHERE id = ?',
    Number(req.params.id)
  );
  if (!result.changes) return res.status(404).json({ error: 'Badcase not found' });
  res.json({ id: Number(req.params.id), message: 'Badcase deleted' });
});

router.get('/reports', auth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all('SELECT id, type, wrong_count, content, created_at FROM extract_reports WHERE user_id = ? ORDER BY created_at DESC, id DESC', req.userId);
  res.json({
    reports: rows.map(row => ({
      ...row,
      created_at_shanghai: formatShanghaiDateTime(row.created_at)
    }))
  });
});

router.get('/reports/:id', auth, async (req, res) => {
  const db = await getDb();
  const row = await db.get('SELECT * FROM extract_reports WHERE id = ? AND user_id = ?', req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  res.json({
    ...row,
    created_at_shanghai: formatShanghaiDateTime(row.created_at)
  });
});

module.exports = router;

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { open } = require('sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/du-tiku.db');

let db;

async function ensureColumn(table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  if (!columns.some(col => col.name === column)) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function migrateDiagnosisReportNumbers() {
  const rows = await db.all(`
    SELECT id, user_id
    FROM ai_diagnosis_reports
    WHERE report_no IS NULL
    ORDER BY user_id ASC, created_at ASC, id ASC
  `);
  const counters = new Map();
  for (const row of rows) {
    if (!counters.has(row.user_id)) {
      const latest = await db.get(
        'SELECT MAX(report_no) as max_no FROM ai_diagnosis_reports WHERE user_id = ? AND report_no IS NOT NULL',
        row.user_id
      );
      counters.set(row.user_id, Number(latest?.max_no || 0));
    }
    const nextNo = counters.get(row.user_id) + 1;
    counters.set(row.user_id, nextNo);
    await db.run('UPDATE ai_diagnosis_reports SET report_no = ? WHERE id = ?', nextNo, row.id);
  }
}

async function cleanupResolvedWrongQuestions() {
  await db.run(`
    DELETE FROM wrong_questions
    WHERE NOT EXISTS (
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
  `);
}

async function init() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      inviter_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      stem TEXT NOT NULL,
      options TEXT NOT NULL,
      answer TEXT NOT NULL,
      analysis TEXT NOT NULL,
      wrong_analysis TEXT NOT NULL,
      knowledge_review TEXT NOT NULL,
      knowledge_tag TEXT NOT NULL,
      variants TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      selected TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS wrong_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      count INTEGER DEFAULT 1,
      last_wrong_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      user_id INTEGER PRIMARY KEY,
      wrong_collection INTEGER DEFAULT 0,
      knowledge_all INTEGER DEFAULT 0,
      ai_extract_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS extract_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      wrong_count INTEGER DEFAULT 0,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_diagnosis_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      report_no INTEGER,
      wrong_count INTEGER DEFAULT 0,
      wrong_total INTEGER DEFAULT 0,
      analyzed_count INTEGER DEFAULT 0,
      total_answered INTEGER DEFAULT 0,
      accuracy INTEGER DEFAULT 0,
      content_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_badcases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      rating TEXT NOT NULL,
      reason TEXT,
      note TEXT,
      user_note TEXT,
      source TEXT,
      issue_type TEXT,
      severity TEXT,
      prompt_version TEXT,
      skill_version TEXT,
      status TEXT,
      context_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_diagnosis_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      report_id INTEGER,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_weak_practice_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      diagnosis_report_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating',
      price_cents INTEGER NOT NULL DEFAULT 990,
      title TEXT,
      intro TEXT,
      content_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      UNIQUE(user_id, diagnosis_report_id)
    );

    CREATE TABLE IF NOT EXISTS ai_weak_practice_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      practice_set_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_weak_practice_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      practice_set_id INTEGER NOT NULL,
      question_index INTEGER NOT NULL,
      selected TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(practice_set_id, question_index)
    );

    CREATE TABLE IF NOT EXISTS invite_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id INTEGER NOT NULL,
      invitee_id INTEGER NOT NULL,
      reward_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureColumn('ai_diagnosis_reports', 'report_no', 'INTEGER');
  await ensureColumn('ai_diagnosis_reports', 'wrong_total', 'INTEGER DEFAULT 0');
  await ensureColumn('ai_diagnosis_reports', 'analyzed_count', 'INTEGER DEFAULT 0');
  await ensureColumn('ai_badcases', 'source', 'TEXT');
  await ensureColumn('ai_badcases', 'user_note', 'TEXT');
  await ensureColumn('ai_badcases', 'issue_type', 'TEXT');
  await ensureColumn('ai_badcases', 'severity', 'TEXT');
  await ensureColumn('ai_badcases', 'prompt_version', 'TEXT');
  await ensureColumn('ai_badcases', 'skill_version', 'TEXT');
  await ensureColumn('ai_badcases', 'status', 'TEXT');
  await ensureColumn('ai_badcases', 'context_json', 'TEXT');

  await db.run(`
    UPDATE ai_diagnosis_reports
    SET wrong_total = CASE WHEN wrong_total IS NULL OR wrong_total = 0 THEN wrong_count ELSE wrong_total END,
        analyzed_count = CASE WHEN analyzed_count IS NULL OR analyzed_count = 0 THEN wrong_count ELSE analyzed_count END
  `);
  await db.run(`
    UPDATE ai_badcases
    SET user_note = CASE
      WHEN (user_note IS NULL OR user_note = '') AND source = 'user_feedback' THEN COALESCE(note, '')
      ELSE COALESCE(user_note, '')
    END
  `);
  await db.run(`
    UPDATE ai_badcases
    SET status = CASE
      WHEN status IN ('processed', 'closed', 'fixed') THEN 'processed'
      ELSE 'unprocessed'
    END
  `);
  await migrateDiagnosisReportNumbers();
  await cleanupResolvedWrongQuestions();
}

async function getDb() {
  if (!db) await init();
  return db;
}

module.exports = { getDb, init };

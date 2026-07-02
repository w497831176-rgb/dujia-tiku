const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { open } = require('sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/du-tiku.db');

let db;

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

    CREATE TABLE IF NOT EXISTS invite_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id INTEGER NOT NULL,
      invitee_id INTEGER NOT NULL,
      reward_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getDb() {
  if (!db) await init();
  return db;
}

module.exports = { getDb, init };

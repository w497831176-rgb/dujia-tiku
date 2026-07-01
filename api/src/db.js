const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { open } = require('sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/du-tiku.db');
let db;

async function init() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      stem TEXT NOT NULL,
      options TEXT NOT NULL,
      answer TEXT NOT NULL,
      analysis TEXT NOT NULL DEFAULT '',
      wrong_analysis TEXT NOT NULL DEFAULT '',
      knowledge_review TEXT NOT NULL DEFAULT '',
      knowledge_tag TEXT NOT NULL DEFAULT '',
      variants TEXT NOT NULL DEFAULT '[]'
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
  `);
}

async function getDb() {
  if (!db) await init();
  return db;
}

module.exports = { getDb, init };

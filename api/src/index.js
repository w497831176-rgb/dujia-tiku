require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/answers', require('./routes/answers'));
app.use('/api/wrong', require('./routes/wrong'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/invite', require('./routes/invite'));

async function start() {
  await init();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dujia-Tiku API running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { router as chatRouter } from './routes/chat.route.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/chat', chatRouter);

app.listen(PORT, () => {
  console.log(`[ai-chatbot-app] Backend listening on port ${PORT}`);
});



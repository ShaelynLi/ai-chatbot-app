import { Router } from 'express';
import { postChatCompletion, postChatTitle } from '../controllers/qwen.controller.js';

export const router = Router();

// POST /api/chat/completions
router.post('/completions', postChatCompletion);

// POST /api/chat/title
router.post('/title', postChatTitle);



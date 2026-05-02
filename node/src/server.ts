import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import whatsappRoutes from './routes/whatsapp';

dotenv.config();

// Erros internos do Puppeteer/whatsapp-web.js (detached Frame, Target closed)
// são promise rejections que não afetam o servidor — suprime para não poluir o log
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes('detached Frame') || msg.includes('Target closed') || msg.includes('Session closed')) return;
  console.error('[UnhandledRejection]', msg);
});

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS bloqueado: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${Date.now() - start}ms`);
  });
  next();
});

app.use('/whatsapp', whatsappRoutes);

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Scala Zap API rodando' });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ message: 'Erro interno' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Servidor iniciado na porta ${port}`);
});

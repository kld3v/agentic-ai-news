import express, { Request, Response } from 'express';
import path from 'path';
import DatabaseManager from './database';

const app = express();
const PORT = process.env.PORT || 3000;
const db = new DatabaseManager();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress || 
         '127.0.0.1';
}

function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function generateNewsHtml(newsItems: any[]): string {
  if (newsItems.length === 0) {
    return '<div class="no-news">No news items yet. Be the first to post!</div>';
  }

  return newsItems.map(item => `
    <div class="news-item" id="news-${item.id}">
      <div class="news-content">
        <p class="news-summary">${escapeHtml(item.summary)}</p>
        <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener" class="news-link">Read more →</a>
      </div>
      <div class="news-actions">
        <button 
          class="vote-btn upvote" 
          hx-post="/vote" 
          hx-vals='{"newsId": ${item.id}, "voteType": "up"}'
          hx-target="#news-${item.id} .vote-score"
          hx-swap="innerHTML">
          ▲
        </button>
        <span class="vote-score">${item.vote_score}</span>
        <button 
          class="vote-btn downvote" 
          hx-post="/vote" 
          hx-vals='{"newsId": ${item.id}, "voteType": "down"}'
          hx-target="#news-${item.id} .vote-score"
          hx-swap="innerHTML">
          ▼
        </button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

app.get('/', async (req: Request, res: Response) => {
  try {
    const newsItems = await db.getAllNewsItems();
    const newsHtml = generateNewsHtml(newsItems);
  
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agentic AI News</title>
    <link rel="stylesheet" href="/style.css">
    <script src="https://unpkg.com/htmx.org@1.9.10"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>Agentic AI News</h1>
            <p class="subtitle">Latest developments in autonomous AI systems</p>
        </header>

        <section class="add-news">
            <h2>Share News</h2>
            <form hx-post="/news" hx-target="#news-list" hx-swap="afterbegin" hx-on="htmx:afterRequest: this.reset()">
                <div class="form-group">
                    <label for="summary">Summary (max 200 chars):</label>
                    <input type="text" id="summary" name="summary" maxlength="200" required 
                           placeholder="e.g., OpenAI's GPT-5 achieves AGI benchmarks in latest evaluation">
                </div>
                <div class="form-group">
                    <label for="link">Article Link:</label>
                    <input type="url" id="link" name="link" required 
                           placeholder="https://example.com/article">
                </div>
                <button type="submit">Submit News</button>
            </form>
        </section>

        <section class="news-section">
            <h2>Latest News</h2>
            <div id="news-list" class="news-list">
                ${newsHtml}
            </div>
        </section>
    </div>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    console.error('Error loading homepage:', error);
    res.status(500).send('Internal server error');
  }
});

app.post('/news', async (req: Request, res: Response) => {
  const { summary, link } = req.body;

  if (!summary || !link) {
    return res.status(400).json({ error: 'Summary and link are required' });
  }

  if (summary.length > 200) {
    return res.status(400).json({ error: 'Summary must be 200 characters or less' });
  }

  if (!isValidUrl(link)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    const newsId = await db.addNewsItem(summary.trim(), link.trim());
    const newsItem = { id: newsId, summary: summary.trim(), link: link.trim(), vote_score: 0, created_at: new Date().toISOString() };
    const newsHtml = generateNewsHtml([newsItem]);
    res.send(newsHtml);
  } catch (error) {
    console.error('Error adding news item:', error);
    res.status(500).json({ error: 'Failed to add news item' });
  }
});

app.post('/vote', async (req: Request, res: Response) => {
  const { newsId, voteType } = req.body;
  const voterIp = getClientIp(req);

  if (!newsId || !voteType || !['up', 'down'].includes(voteType)) {
    return res.status(400).json({ error: 'Invalid vote data' });
  }

  try {
    const success = await db.vote(parseInt(newsId), voteType, voterIp);
    if (success) {
      const newsItems = await db.getAllNewsItems();
      const newsItem = newsItems.find(item => item.id === parseInt(newsId));
      res.send(newsItem ? newsItem.vote_score.toString() : '0');
    } else {
      res.status(409).json({ error: 'Vote unchanged' });
    }
  } catch (error) {
    console.error('Error voting:', error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

process.on('SIGINT', () => {
  console.log('\\nShutting down gracefully...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\nShutting down gracefully...');
  db.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Agentic AI News server running on http://localhost:${PORT}`);
});

export default app;
import sqlite3 from 'sqlite3';
import path from 'path';

export interface NewsItem {
  id: number;
  summary: string;
  link: string;
  created_at: string;
  vote_score: number;
}

export interface Vote {
  id: number;
  news_item_id: number;
  vote_type: 'up' | 'down';
  voter_ip: string;
  created_at: string;
}

class DatabaseManager {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(path.join(process.cwd(), 'agentic_news.db'));
    this.initializeTables();
  }

  private initializeTables(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS news_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL CHECK(length(summary) <= 200),
        link TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        vote_score INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        news_item_id INTEGER NOT NULL,
        vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
        voter_ip TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (news_item_id) REFERENCES news_items (id) ON DELETE CASCADE,
        UNIQUE(news_item_id, voter_ip)
      );

      CREATE INDEX IF NOT EXISTS idx_news_vote_score ON news_items(vote_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_votes_news_id ON votes(news_item_id);
    `;
    this.db.exec(sql);
  }

  addNewsItem(summary: string, link: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO news_items (summary, link) 
        VALUES (?, ?)
      `);
      stmt.run(summary, link, function(this: any, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
      stmt.finalize();
    });
  }

  getAllNewsItems(): Promise<NewsItem[]> {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM news_items 
        ORDER BY vote_score DESC, created_at DESC
      `, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as NewsItem[]);
        }
      });
    });
  }

  vote(newsItemId: number, voteType: 'up' | 'down', voterIp: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.get(`
          SELECT vote_type FROM votes 
          WHERE news_item_id = ? AND voter_ip = ?
        `, [newsItemId, voterIp], (err, existingVote: any) => {
          if (err) {
            reject(err);
            return;
          }

          if (existingVote) {
            if (existingVote.vote_type === voteType) {
              resolve(false);
              return;
            }
            
            this.db.run(`
              UPDATE votes 
              SET vote_type = ?, created_at = CURRENT_TIMESTAMP 
              WHERE news_item_id = ? AND voter_ip = ?
            `, [voteType, newsItemId, voterIp], (err) => {
              if (err) {
                reject(err);
                return;
              }
              this.updateVoteScore(newsItemId).then(() => resolve(true)).catch(reject);
            });
          } else {
            this.db.run(`
              INSERT INTO votes (news_item_id, vote_type, voter_ip) 
              VALUES (?, ?, ?)
            `, [newsItemId, voteType, voterIp], (err) => {
              if (err) {
                reject(err);
                return;
              }
              this.updateVoteScore(newsItemId).then(() => resolve(true)).catch(reject);
            });
          }
        });
      });
    });
  }

  private updateVoteScore(newsItemId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) as upvotes,
          SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downvotes
        FROM votes 
        WHERE news_item_id = ?
      `, [newsItemId], (err, result: any) => {
        if (err) {
          reject(err);
          return;
        }

        const voteScore = (result.upvotes || 0) - (result.downvotes || 0);
        this.db.run(`
          UPDATE news_items 
          SET vote_score = ? 
          WHERE id = ?
        `, [voteScore, newsItemId], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }

  close(): void {
    this.db.close();
  }
}

export default DatabaseManager;
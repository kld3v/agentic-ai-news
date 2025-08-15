import sqlite3 from 'sqlite3';
import { Client } from 'pg';
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
  private db: sqlite3.Database | null = null;
  private pgClient: Client | null = null;
  private isPostgres: boolean;

  constructor() {
    // Use PostgreSQL in production if DATABASE_URL is provided (Railway sets this)
    this.isPostgres = !!process.env.DATABASE_URL;
    
    if (this.isPostgres) {
      this.pgClient = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
      this.connectPostgres();
    } else {
      this.db = new sqlite3.Database(path.join(process.cwd(), 'agentic_news.db'));
      this.initializeTables();
    }
  }

  private async connectPostgres(): Promise<void> {
    try {
      if (this.pgClient) {
        await this.pgClient.connect();
        console.log('✅ Connected to PostgreSQL database');
        await this.initializePostgresTables();
      }
    } catch (error) {
      console.error('❌ Failed to connect to PostgreSQL:', error);
      process.exit(1);
    }
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
    this.db!.exec(sql);
  }

  private async initializePostgresTables(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS news_items (
        id SERIAL PRIMARY KEY,
        summary TEXT NOT NULL CHECK(length(summary) <= 200),
        link TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vote_score INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        news_item_id INTEGER NOT NULL,
        vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
        voter_ip TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (news_item_id) REFERENCES news_items (id) ON DELETE CASCADE,
        UNIQUE(news_item_id, voter_ip)
      );

      CREATE INDEX IF NOT EXISTS idx_news_vote_score ON news_items(vote_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_votes_news_id ON votes(news_item_id);
    `;
    
    if (this.pgClient) {
      await this.pgClient.query(sql);
      console.log('✅ PostgreSQL tables initialized');
    }
  }

  async addNewsItem(summary: string, link: string): Promise<number> {
    if (this.isPostgres && this.pgClient) {
      const result = await this.pgClient.query(
        'INSERT INTO news_items (summary, link) VALUES ($1, $2) RETURNING id',
        [summary, link]
      );
      return result.rows[0].id;
    } else {
      return new Promise((resolve, reject) => {
        const stmt = this.db!.prepare(`
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
  }

  async getAllNewsItems(): Promise<NewsItem[]> {
    if (this.isPostgres && this.pgClient) {
      const result = await this.pgClient.query(
        'SELECT * FROM news_items ORDER BY vote_score DESC, created_at DESC'
      );
      return result.rows;
    } else {
      return new Promise((resolve, reject) => {
        this.db!.all(`
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
  }

  async getNewsItemsBySort(sortType: 'top' | 'new' | 'classic'): Promise<NewsItem[]> {
    let query = '';
    
    if (this.isPostgres) {
      switch (sortType) {
        case 'top':
          query = `
            SELECT * FROM news_items 
            WHERE DATE(created_at) = CURRENT_DATE
            ORDER BY vote_score DESC, created_at DESC
          `;
          break;
        case 'new':
          query = `
            SELECT * FROM news_items 
            ORDER BY created_at DESC
          `;
          break;
        case 'classic':
          query = `
            SELECT * FROM news_items 
            ORDER BY vote_score DESC, created_at DESC
          `;
          break;
        default:
          query = `
            SELECT * FROM news_items 
            ORDER BY vote_score DESC, created_at DESC
          `;
      }
      
      if (this.pgClient) {
        const result = await this.pgClient.query(query);
        return result.rows;
      }
    } else {
      switch (sortType) {
        case 'top':
          query = `
            SELECT * FROM news_items 
            WHERE date(created_at) = date('now')
            ORDER BY vote_score DESC, created_at DESC
          `;
          break;
        case 'new':
          query = `
            SELECT * FROM news_items 
            ORDER BY created_at DESC
          `;
          break;
        case 'classic':
          query = `
            SELECT * FROM news_items 
            ORDER BY vote_score DESC, created_at DESC
          `;
          break;
        default:
          query = `
            SELECT * FROM news_items 
            ORDER BY vote_score DESC, created_at DESC
          `;
      }
      
      return new Promise((resolve, reject) => {
        this.db!.all(query, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as NewsItem[]);
          }
        });
      });
    }
    
    return [];
  }

  async vote(newsItemId: number, voteType: 'up' | 'down', voterIp: string): Promise<boolean> {
    if (this.isPostgres && this.pgClient) {
      try {
        // Check existing vote
        const existingVote = await this.pgClient.query(
          'SELECT vote_type FROM votes WHERE news_item_id = $1 AND voter_ip = $2',
          [newsItemId, voterIp]
        );

        if (existingVote.rows.length > 0) {
          if (existingVote.rows[0].vote_type === voteType) {
            return false; // Same vote, no change
          }
          
          // Update existing vote
          await this.pgClient.query(
            'UPDATE votes SET vote_type = $1, created_at = CURRENT_TIMESTAMP WHERE news_item_id = $2 AND voter_ip = $3',
            [voteType, newsItemId, voterIp]
          );
        } else {
          // Insert new vote
          await this.pgClient.query(
            'INSERT INTO votes (news_item_id, vote_type, voter_ip) VALUES ($1, $2, $3)',
            [newsItemId, voteType, voterIp]
          );
        }

        await this.updateVoteScore(newsItemId);
        return true;
      } catch (error) {
        throw error;
      }
    } else {
      // SQLite version
      return new Promise((resolve, reject) => {
        this.db!.serialize(() => {
          this.db!.get(`
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
              
              this.db!.run(`
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
              this.db!.run(`
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
  }

  private async updateVoteScore(newsItemId: number): Promise<void> {
    if (this.isPostgres && this.pgClient) {
      const result = await this.pgClient.query(`
        SELECT 
          SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) as upvotes,
          SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downvotes
        FROM votes 
        WHERE news_item_id = $1
      `, [newsItemId]);

      const upvotes = parseInt(result.rows[0].upvotes) || 0;
      const downvotes = parseInt(result.rows[0].downvotes) || 0;
      const voteScore = upvotes - downvotes;

      await this.pgClient.query(
        'UPDATE news_items SET vote_score = $1 WHERE id = $2',
        [voteScore, newsItemId]
      );
    } else {
      return new Promise((resolve, reject) => {
        this.db!.get(`
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
          this.db!.run(`
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
  }

  close(): void {
    if (this.isPostgres && this.pgClient) {
      this.pgClient.end();
    } else if (this.db) {
      this.db.close();
    }
  }
}

export default DatabaseManager;
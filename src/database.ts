import sqlite3 from 'sqlite3';
import { Client } from 'pg';
import path from 'path';

export interface NewsItem {
  id: number;
  summary: string;
  link: string;
  author: string;
  created_at: string;
  vote_score: number;
  human_upvotes?: number;
  human_downvotes?: number;
  machine_upvotes?: number;
  machine_downvotes?: number;
}

export interface Vote {
  id: number;
  news_item_id: number;
  vote_type: 'up' | 'down';
  voter_ip: string;
  vote_source: 'human' | 'machine';
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
        author TEXT NOT NULL DEFAULT 'Anonymous',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        vote_score INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        news_item_id INTEGER NOT NULL,
        vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
        voter_ip TEXT NOT NULL,
        vote_source TEXT NOT NULL DEFAULT 'human' CHECK(vote_source IN ('human', 'machine')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (news_item_id) REFERENCES news_items (id) ON DELETE CASCADE,
        UNIQUE(news_item_id, voter_ip, vote_source)
      );

      CREATE INDEX IF NOT EXISTS idx_news_vote_score ON news_items(vote_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_votes_news_id ON votes(news_item_id);
    `;
    this.db!.exec(sql);
    this.migrateVotesTable();
    this.migrateNewsItemsTable();
  }

  private migrateVotesTable(): void {
    // Check if vote_source column exists, if not, add it
    this.db!.get("PRAGMA table_info(votes)", (err, result) => {
      if (!err) {
        this.db!.all("PRAGMA table_info(votes)", (err, columns: any[]) => {
          if (!err) {
            const hasVoteSource = columns.some(col => col.name === 'vote_source');
            if (!hasVoteSource) {
              console.log('🔄 Migrating votes table to add vote_source column...');
              this.db!.exec(`
                ALTER TABLE votes ADD COLUMN vote_source TEXT NOT NULL DEFAULT 'human' CHECK(vote_source IN ('human', 'machine'));
                
                -- Drop old unique constraint and create new one
                CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique ON votes(news_item_id, voter_ip, vote_source);
              `);
              console.log('✅ Votes table migration completed');
            }
          }
        });
      }
    });
  }

  private migrateNewsItemsTable(): void {
    // Check if author column exists, if not, add it
    this.db!.get("PRAGMA table_info(news_items)", (err, result) => {
      if (!err) {
        this.db!.all("PRAGMA table_info(news_items)", (err, columns: any[]) => {
          if (!err) {
            const hasAuthor = columns.some(col => col.name === 'author');
            if (!hasAuthor) {
              console.log('🔄 Migrating news_items table to add author column...');
              this.db!.exec(`
                ALTER TABLE news_items ADD COLUMN author TEXT NOT NULL DEFAULT 'Anonymous';
              `);
              console.log('✅ News items table migration completed');
            }
          }
        });
      }
    });
  }

  private async initializePostgresTables(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS news_items (
        id SERIAL PRIMARY KEY,
        summary TEXT NOT NULL CHECK(length(summary) <= 200),
        link TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'Anonymous',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vote_score INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        news_item_id INTEGER NOT NULL,
        vote_type TEXT NOT NULL CHECK(vote_type IN ('up', 'down')),
        voter_ip TEXT NOT NULL,
        vote_source TEXT NOT NULL DEFAULT 'human' CHECK(vote_source IN ('human', 'machine')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (news_item_id) REFERENCES news_items (id) ON DELETE CASCADE,
        UNIQUE(news_item_id, voter_ip, vote_source)
      );

      CREATE INDEX IF NOT EXISTS idx_news_vote_score ON news_items(vote_score DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_votes_news_id ON votes(news_item_id);
    `;
    
    if (this.pgClient) {
      await this.pgClient.query(sql);
      console.log('✅ PostgreSQL tables initialized');
    }
  }

  async addNewsItem(summary: string, link: string, author: string = 'Anonymous'): Promise<number> {
    if (this.isPostgres && this.pgClient) {
      const result = await this.pgClient.query(
        'INSERT INTO news_items (summary, link, author) VALUES ($1, $2, $3) RETURNING id',
        [summary, link, author]
      );
      return result.rows[0].id;
    } else {
      return new Promise((resolve, reject) => {
        const stmt = this.db!.prepare(`
          INSERT INTO news_items (summary, link, author) 
          VALUES (?, ?, ?)
        `);
        stmt.run(summary, link, author, function(this: any, err: Error | null) {
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

  async vote(newsItemId: number, voteType: 'up' | 'down', voterIp: string, voteSource: 'human' | 'machine' = 'human'): Promise<boolean> {
    if (this.isPostgres && this.pgClient) {
      try {
        // Check existing vote
        const existingVote = await this.pgClient.query(
          'SELECT vote_type FROM votes WHERE news_item_id = $1 AND voter_ip = $2 AND vote_source = $3',
          [newsItemId, voterIp, voteSource]
        );

        if (existingVote.rows.length > 0) {
          if (existingVote.rows[0].vote_type === voteType) {
            return false; // Same vote, no change
          }
          
          // Update existing vote
          await this.pgClient.query(
            'UPDATE votes SET vote_type = $1, created_at = CURRENT_TIMESTAMP WHERE news_item_id = $2 AND voter_ip = $3 AND vote_source = $4',
            [voteType, newsItemId, voterIp, voteSource]
          );
        } else {
          // Insert new vote
          await this.pgClient.query(
            'INSERT INTO votes (news_item_id, vote_type, voter_ip, vote_source) VALUES ($1, $2, $3, $4)',
            [newsItemId, voteType, voterIp, voteSource]
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
            WHERE news_item_id = ? AND voter_ip = ? AND vote_source = ?
          `, [newsItemId, voterIp, voteSource], (err, existingVote: any) => {
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
                WHERE news_item_id = ? AND voter_ip = ? AND vote_source = ?
              `, [voteType, newsItemId, voterIp, voteSource], (err) => {
                if (err) {
                  reject(err);
                  return;
                }
                this.updateVoteScore(newsItemId).then(() => resolve(true)).catch(reject);
              });
            } else {
              this.db!.run(`
                INSERT INTO votes (news_item_id, vote_type, voter_ip, vote_source) 
                VALUES (?, ?, ?, ?)
              `, [newsItemId, voteType, voterIp, voteSource], (err) => {
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

  async getVoteCounts(newsItemId: number): Promise<{human_upvotes: number, human_downvotes: number, machine_upvotes: number, machine_downvotes: number}> {
    if (this.isPostgres && this.pgClient) {
      const result = await this.pgClient.query(`
        SELECT 
          vote_source,
          SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) as upvotes,
          SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downvotes
        FROM votes 
        WHERE news_item_id = $1
        GROUP BY vote_source
      `, [newsItemId]);

      const counts = {
        human_upvotes: 0,
        human_downvotes: 0,
        machine_upvotes: 0,
        machine_downvotes: 0
      };

      result.rows.forEach(row => {
        if (row.vote_source === 'human') {
          counts.human_upvotes = parseInt(row.upvotes) || 0;
          counts.human_downvotes = parseInt(row.downvotes) || 0;
        } else if (row.vote_source === 'machine') {
          counts.machine_upvotes = parseInt(row.upvotes) || 0;
          counts.machine_downvotes = parseInt(row.downvotes) || 0;
        }
      });

      return counts;
    } else {
      return new Promise((resolve, reject) => {
        this.db!.all(`
          SELECT 
            vote_source,
            SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) as upvotes,
            SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) as downvotes
          FROM votes 
          WHERE news_item_id = ?
          GROUP BY vote_source
        `, [newsItemId], (err, rows: any[]) => {
          if (err) {
            reject(err);
            return;
          }

          const counts = {
            human_upvotes: 0,
            human_downvotes: 0,
            machine_upvotes: 0,
            machine_downvotes: 0
          };

          rows.forEach(row => {
            if (row.vote_source === 'human') {
              counts.human_upvotes = row.upvotes || 0;
              counts.human_downvotes = row.downvotes || 0;
            } else if (row.vote_source === 'machine') {
              counts.machine_upvotes = row.upvotes || 0;
              counts.machine_downvotes = row.downvotes || 0;
            }
          });

          resolve(counts);
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
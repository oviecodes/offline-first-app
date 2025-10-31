const Database = require("better-sqlite3")
const path = require("path")

class NotesDatabase {
  constructor() {
    this.db = new Database(path.join(__dirname, "notes.db"))
    this.init()
  }

  init() {
    // Create notes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        clientId TEXT,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      )
    `)

    console.log("Database initialized")
  }

  getAllNotes() {
    const stmt = this.db.prepare("SELECT * FROM notes ORDER BY updated DESC")
    return stmt.all()
  }

  getNote(id) {
    const stmt = this.db.prepare("SELECT * FROM notes WHERE id = ?")
    return stmt.get(id)
  }

  createNote({ content, clientId, created, updated }) {
    const stmt = this.db.prepare(`
      INSERT INTO notes (content, clientId, created, updated)
      VALUES (?, ?, ?, ?)
    `)

    const info = stmt.run(content, clientId || null, created, updated)
    return this.getNote(info.lastInsertRowid)
  }

  updateNote(id, { content, updated }) {
    const stmt = this.db.prepare(`
      UPDATE notes 
      SET content = ?, updated = ?
      WHERE id = ?
    `)

    const info = stmt.run(content, updated, id)
    return info.changes > 0 ? this.getNote(id) : null
  }

  deleteNote(id) {
    const stmt = this.db.prepare("DELETE FROM notes WHERE id = ?")
    const info = stmt.run(id)
    return info.changes > 0
  }

  close() {
    this.db.close()
  }
}

module.exports = NotesDatabase

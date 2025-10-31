const express = require("express")
const cors = require("cors")
const path = require("path")
const Database = require("./database")

const app = express()
const PORT = 3000

// Initialize database
const db = new Database()

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static("public"))

app.use((req, res, next) => {
  console.log("new request", req.body)
  next()
})

// API Routes

// Get all notes
app.get("/api/notes", (req, res) => {
  try {
    const notes = db.getAllNotes()
    res.json(notes)
  } catch (error) {
    console.error("Error fetching notes:", error)
    res.status(500).json({ error: "Failed to fetch notes" })
  }
})

// Create a new note
app.post("/api/notes", (req, res) => {
  try {
    const { content, clientId, created, updated } = req.body

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Content is required" })
    }

    const note = db.createNote({
      content: content.trim(),
      clientId,
      created: created || Date.now(),
      updated: updated || Date.now(),
    })

    console.log("Created note:", note.id)
    res.status(201).json(note)
  } catch (error) {
    console.error("Error creating note:", error)
    res.status(500).json({ error: "Failed to create note" })
  }
})

// Update a note
app.put("/api/notes/:id", (req, res) => {
  try {
    const { id } = req.params
    const { content, updated } = req.body

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Content is required" })
    }

    const note = db.updateNote(parseInt(id), {
      content: content.trim(),
      updated: updated || Date.now(),
    })

    if (!note) {
      return res.status(404).json({ error: "Note not found" })
    }

    console.log("Updated note:", id)
    res.json(note)
  } catch (error) {
    console.error("Error updating note:", error)
    res.status(500).json({ error: "Failed to update note" })
  }
})

// Delete a note
app.delete("/api/notes/:id", (req, res) => {
  try {
    const { id } = req.params
    const success = db.deleteNote(parseInt(id))

    if (!success) {
      return res.status(404).json({ error: "Note not found" })
    }

    console.log("Deleted note:", id)
    res.status(204).send()
  } catch (error) {
    console.error("Error deleting note:", error)
    res.status(500).json({ error: "Failed to delete note" })
  }
})

// Batch sync endpoint (for syncing multiple operations at once)
app.post("/api/sync", (req, res) => {
  try {
    const { operations } = req.body
    const results = []

    for (const op of operations) {
      try {
        let result
        switch (op.type) {
          case "create":
            result = db.createNote({
              content: op.content,
              clientId: op.clientId,
              created: op.created,
              updated: op.updated,
            })
            results.push({ success: true, operation: op, result })
            break

          case "update":
            result = db.updateNote(op.serverId, {
              content: op.content,
              updated: op.updated,
            })
            results.push({ success: true, operation: op, result })
            break

          case "delete":
            db.deleteNote(op.serverId)
            results.push({ success: true, operation: op })
            break

          default:
            results.push({
              success: false,
              operation: op,
              error: "Unknown operation",
            })
        }
      } catch (error) {
        results.push({ success: false, operation: op, error: error.message })
      }
    }

    console.log(`Synced ${results.length} operations`)
    res.json({ results })
  } catch (error) {
    console.error("Error in batch sync:", error)
    res.status(500).json({ error: "Failed to sync" })
  }
})

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() })
})

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  Offline Notes Server Running          ║
║                                        ║
║  Local:  http://localhost:${PORT}        ║
║  API:    http://localhost:${PORT}/api   ║
║                                        ║
║  To expose via ngrok:                  ║
║  $ ngrok http ${PORT}                     ║
╚════════════════════════════════════════╝
  `)
})

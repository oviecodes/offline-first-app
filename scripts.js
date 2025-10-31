class NotesDB {
  constructor() {
    this.db = null
    this.dbName = "offline-notes-db"
    this.version = 1
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains("notes")) {
          const store = db.createObjectStore("notes", {
            keyPath: "id",
            autoIncrement: true,
          })
          store.createIndex("updated", "updated", { unique: false })
        }
      }
    })
  }

  async addNote(content) {
    const note = {
      content,
      created: Date.now(),
      updated: Date.now(),
      synced: false,
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readwrite")
      const store = tx.objectStore("notes")
      const request = store.add(note)

      request.onsuccess = () => resolve({ ...note, id: request.result })
      request.onerror = () => reject(request.error)
    })
  }

  async getAllNotes() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readonly")
      const store = tx.objectStore("notes")
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async updateNote(id, content) {
    const note = await this.getNote(id)
    note.content = content
    note.updated = Date.now()
    note.synced = false

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readwrite")
      const store = tx.objectStore("notes")
      const request = store.put(note)

      request.onsuccess = () => resolve(note)
      request.onerror = () => reject(request.error)
    })
  }

  async getNote(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readonly")
      const store = tx.objectStore("notes")
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteNote(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readwrite")
      const store = tx.objectStore("notes")
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

// App logic
const db = new NotesDB()
let editingNoteId = null

function updateOnlineStatus() {
  const status = document.getElementById("status")
  const statusText = document.getElementById("statusText")

  if (navigator.onLine) {
    status.className = "status online"
    statusText.textContent = "🟢 Online"
  } else {
    status.className = "status offline"
    statusText.textContent = "🔴 Offline"
  }
}

function formatDate(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`

  return (
    date.toLocaleDateString() +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  )
}

async function renderNotes() {
  const notesList = document.getElementById("notesList")
  const notes = await db.getAllNotes()

  if (notes.length === 0) {
    notesList.innerHTML = `
  <div class="empty-state">
    <h3>No notes yet</h3>
    <p>Create your first note above to get started!</p>
  </div>
`
    return
  }

  // Sort by most recently updated
  notes.sort((a, b) => b.updated - a.updated)

  notesList.innerHTML = notes
    .map(
      (note) => `
<div class="note-card">
  <div class="note-header">
    <div class="note-time">${formatDate(note.updated)}</div>
    <div class="note-badge ${note.synced ? "synced" : ""}">
      ${note.synced ? "✓ Synced" : "⟳ Local"}
    </div>
  </div>
  <div class="note-content">${escapeHtml(note.content)}</div>
  <div class="note-actions">
    <button class="btn btn-small" onclick="editNote(${note.id})">Edit</button>
    <button class="btn btn-small btn-delete" onclick="deleteNote(${
      note.id
    })">Delete</button>
  </div>
</div>
`
    )
    .join("")
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

async function createOrUpdateNote() {
  const input = document.getElementById("noteInput")
  const content = input.value.trim()

  if (!content) {
    alert("Please write something first!")
    return
  }

  if (editingNoteId) {
    await db.updateNote(editingNoteId, content)
    editingNoteId = null
    document.getElementById("createBtn").textContent = "Save Note"
  } else {
    await db.addNote(content)
  }

  input.value = ""
  await renderNotes()
}

window.editNote = async function (id) {
  const note = await db.getNote(id)
  document.getElementById("noteInput").value = note.content
  document.getElementById("createBtn").textContent = "Update Note"
  editingNoteId = id
  window.scrollTo({ top: 0, behavior: "smooth" })
}

window.deleteNote = async function (id) {
  if (confirm("Delete this note?")) {
    await db.deleteNote(id)
    await renderNotes()
  }
}

// Initialize app
async function init() {
  await db.init()
  await renderNotes()
  updateOnlineStatus()

  document
    .getElementById("createBtn")
    .addEventListener("click", createOrUpdateNote)

  // Handle Enter key in textarea (Ctrl+Enter to save)
  document.getElementById("noteInput").addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
      createOrUpdateNote()
    }
  })

  // Update online/offline status
  window.addEventListener("online", updateOnlineStatus)
  window.addEventListener("offline", updateOnlineStatus)
}

init()

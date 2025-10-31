const API_URL = "http://localhost:3000/api"
class NotesDB {
  constructor() {
    this.db = null
    this.dbName = "offline-notes-db"
    this.version = 2
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

        // Notes store
        if (!db.objectStoreNames.contains("notes")) {
          const notesStore = db.createObjectStore("notes", {
            keyPath: "clientId",
          })
          notesStore.createIndex("updated", "updated", { unique: false })
          notesStore.createIndex("serverId", "serverId", { unique: false })
        }

        // Sync queue store
        if (!db.objectStoreNames.contains("syncQueue")) {
          db.createObjectStore("syncQueue", {
            keyPath: "id",
            autoIncrement: true,
          })
        }
      }
    })
  }

  generateId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  async addNote(content) {
    const clientId = this.generateId()
    const note = {
      clientId,
      serverId: null,
      content,
      created: Date.now(),
      updated: Date.now(),
      synced: false,
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes", "syncQueue"], "readwrite")

      // Add note
      const notesStore = tx.objectStore("notes")
      notesStore.add(note)

      // Queue sync operation
      const queueStore = tx.objectStore("syncQueue")
      queueStore.add({
        type: "create",
        clientId,
        content,
        created: note.created,
        updated: note.updated,
        timestamp: Date.now(),
      })

      tx.oncomplete = () => resolve(note)
      tx.onerror = () => reject(tx.error)
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

  async getNoteByClientId(clientId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readonly")
      const store = tx.objectStore("notes")
      const request = store.get(clientId)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async updateNote(clientId, content) {
    const note = await this.getNoteByClientId(clientId)
    if (!note) throw new Error("Note not found")

    note.content = content
    note.updated = Date.now()
    note.synced = false

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes", "syncQueue"], "readwrite")

      // Update note
      const notesStore = tx.objectStore("notes")
      notesStore.put(note)

      // Queue sync operation
      const queueStore = tx.objectStore("syncQueue")
      queueStore.add({
        type: "update",
        clientId,
        serverId: note.serverId,
        content,
        updated: note.updated,
        timestamp: Date.now(),
      })

      tx.oncomplete = () => resolve(note)
      tx.onerror = () => reject(tx.error)
    })
  }

  async deleteNote(clientId) {
    const note = await this.getNoteByClientId(clientId)

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes", "syncQueue"], "readwrite")

      // Delete note
      const notesStore = tx.objectStore("notes")
      notesStore.delete(clientId)

      // Queue sync operation (only if it was synced to server)
      if (note && note.serverId) {
        const queueStore = tx.objectStore("syncQueue")
        queueStore.add({
          type: "delete",
          clientId,
          serverId: note.serverId,
          timestamp: Date.now(),
        })
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getSyncQueue() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["syncQueue"], "readonly")
      const store = tx.objectStore("syncQueue")
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async clearSyncQueue() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["syncQueue"], "readwrite")
      const store = tx.objectStore("syncQueue")
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async markNoteSynced(clientId, serverId) {
    const note = await this.getNoteByClientId(clientId)
    if (!note) return

    note.synced = true
    note.serverId = serverId

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["notes"], "readwrite")
      const store = tx.objectStore("notes")
      const request = store.put(note)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

// App state
const db = new NotesDB()
let editingNoteId = null
let isSyncing = false

// UI updates
function updateNetworkStatus() {
  const status = document.getElementById("networkStatus")
  const statusText = document.getElementById("networkStatusText")

  if (navigator.onLine) {
    status.className = "status online"
    statusText.textContent = "🟢 Online"
    // Auto-sync when coming back online
    setTimeout(() => syncToServer(), 1000)
  } else {
    status.className = "status offline"
    statusText.textContent = "🔴 Offline"
  }
}

function updateSyncStatus(message, type = "ready") {
  const status = document.getElementById("syncStatus")
  const statusText = document.getElementById("syncStatusText")

  status.className = `status sync-status ${type}`
  statusText.innerHTML = message
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

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
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

  notes.sort((a, b) => b.updated - a.updated)

  notesList.innerHTML = notes
    .map(
      (note) => `
    <div class="note-card ${!note.synced ? "pending-sync" : ""}">
      <div class="note-header">
        <div class="note-time">${formatDate(note.updated)}</div>
        <div class="note-badge ${note.synced ? "synced" : "pending"}">
          ${note.synced ? "✓ Synced" : "⟳ Pending"}
        </div>
      </div>
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-actions">
        <button class="btn btn-small" onclick="editNote('${
          note.clientId
        }')">Edit</button>
        <button class="btn btn-small btn-delete" onclick="deleteNote('${
          note.clientId
        }')">Delete</button>
      </div>
    </div>
  `
    )
    .join("")
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

  // Try to sync if online
  if (navigator.onLine) {
    setTimeout(() => syncToServer(), 500)
  }
}

window.editNote = async function (clientId) {
  const note = await db.getNoteByClientId(clientId)
  document.getElementById("noteInput").value = note.content
  document.getElementById("createBtn").textContent = "Update Note"
  editingNoteId = clientId
  window.scrollTo({ top: 0, behavior: "smooth" })
}

window.deleteNote = async function (clientId) {
  if (confirm("Delete this note?")) {
    await db.deleteNote(clientId)
    await renderNotes()

    // Try to sync if online
    if (navigator.onLine) {
      setTimeout(() => syncToServer(), 500)
    }
  }
}

async function syncToServer() {
  if (!navigator.onLine || isSyncing) return

  const queue = await db.getSyncQueue()
  if (queue.length === 0) {
    updateSyncStatus("All synced", "synced")
    return
  }

  isSyncing = true
  updateSyncStatus(
    `<span class="spinning">⟳</span> Syncing ${queue.length} change(s)...`,
    "syncing"
  )

  try {
    // Process sync queue
    for (const operation of queue) {
      try {
        if (operation.type === "create") {
          const response = await fetch(`${API_URL}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: operation.content,
              clientId: operation.clientId,
              created: operation.created,
              updated: operation.updated,
            }),
          })

          if (response.ok) {
            const serverNote = await response.json()
            await db.markNoteSynced(operation.clientId, serverNote.id)
          }
        } else if (operation.type === "update" && operation.serverId) {
          const response = await fetch(
            `${API_URL}/notes/${operation.serverId}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: operation.content,
                updated: operation.updated,
              }),
            }
          )

          if (response.ok) {
            await db.markNoteSynced(operation.clientId, operation.serverId)
          }
        } else if (operation.type === "delete" && operation.serverId) {
          await fetch(`${API_URL}/notes/${operation.serverId}`, {
            method: "DELETE",
          })
        }
      } catch (error) {
        console.error("Failed to sync operation:", operation, error)
        throw error // Stop syncing if one fails
      }
    }

    // Clear sync queue
    await db.clearSyncQueue()
    updateSyncStatus("✓ All synced", "synced")
    await renderNotes()
  } catch (error) {
    console.error("Sync failed:", error)
    updateSyncStatus("⚠ Sync failed - will retry", "ready")
  } finally {
    isSyncing = false
  }
}

async function init() {
  await db.init()
  await renderNotes()
  updateNetworkStatus()

  // Event listeners
  document
    .getElementById("createBtn")
    .addEventListener("click", createOrUpdateNote)
  document.getElementById("syncBtn").addEventListener("click", () => {
    if (navigator.onLine) {
      syncToServer()
    } else {
      alert("Cannot sync while offline")
    }
  })

  document.getElementById("noteInput").addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
      createOrUpdateNote()
    }
  })

  // Network status listeners
  // window.addEventListener('online', updateNetwork

  window.addEventListener("online", updateNetworkStatus)
  window.addEventListener("offline", updateNetworkStatus)
}

init()

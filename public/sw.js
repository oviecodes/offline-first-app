// Service Worker for offline-first notes app
const CACHE_NAME = "notes-app-v1"
const API_URL = "http://localhost:3000/api" // UPDATE THIS if using ngrok

// Assets to cache on install
const ASSETS = ["/", "/index.html"]

// Install event - cache assets
self.addEventListener("install", (event) => {
  console.log("[SW] Installing...")
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching app assets")
        return cache.addAll(ASSETS)
      })
      .then(() => self.skipWaiting())
  )
})

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...")
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      })
      .then(() => self.clients.claim())
  )
})

// Fetch event - network first, fallback to cache
self.addEventListener("fetch", (event) => {
  const { request } = event

  // API requests: network-first strategy
  if (request.url.includes("/api/")) {
    event.respondWith(
      fetch(request).catch(() => {
        // If network fails, we're offline
        return new Response(
          JSON.stringify({ error: "Offline", offline: true }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        )
      })
    )
    return
  }

  // Assets: cache-first strategy
  event.respondWith(
    caches.match(request).then((response) => response || fetch(request))
  )
})

// Background Sync - sync when connection returns
self.addEventListener("sync", (event) => {
  console.log("[SW] Background sync triggered:", event.tag)

  if (event.tag === "sync-notes") {
    event.waitUntil(syncNotes())
  }
})

async function syncNotes() {
  console.log("[SW] Starting background sync...")

  try {
    // Open IndexedDB
    const db = await openDB()
    const queue = await getSyncQueue(db)

    if (queue.length === 0) {
      console.log("[SW] Nothing to sync")
      return
    }

    console.log(`[SW] Syncing ${queue.length} operations...`)

    // Process each operation
    for (const operation of queue) {
      try {
        await syncOperation(operation)
        await removeSyncOperation(db, operation.id)
        console.log("[SW] ✓ Synced:", operation.type, operation.id)
      } catch (error) {
        console.error("[SW] ✗ Failed to sync:", operation.type, error)
        // Don't remove from queue if failed - will retry later
        throw error
      }
    }

    // Notify all clients that sync is complete
    const clients = await self.clients.matchAll()
    clients.forEach((client) => {
      client.postMessage({ type: "SYNC_COMPLETE" })
    })

    console.log("[SW] Sync complete!")
  } catch (error) {
    console.error("[SW] Sync failed:", error)
    throw error // This will cause the sync to be retried
  }
}

async function syncOperation(operation) {
  let response

  switch (operation.type) {
    case "create":
      response = await fetch(`${API_URL}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: operation.content,
          clientId: operation.clientId,
          created: operation.created,
          updated: operation.updated,
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const serverNote = await response.json()

      // Update local note with server ID
      const db = await openDB()
      await markNoteSynced(db, operation.clientId, serverNote.id)
      break

    case "update":
      if (!operation.serverId) {
        console.log("[SW] Skipping update - no server ID yet")
        return
      }

      response = await fetch(`${API_URL}/notes/${operation.serverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: operation.content,
          updated: operation.updated,
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      break

    case "delete":
      if (!operation.serverId) {
        console.log("[SW] Skipping delete - no server ID yet")
        return
      }

      response = await fetch(`${API_URL}/notes/${operation.serverId}`, {
        method: "DELETE",
      })

      if (!response.ok && response.status !== 404) {
        throw new Error(`HTTP ${response.status}`)
      }
      break
  }
}

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("offline-notes-db", 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getSyncQueue(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["syncQueue"], "readonly")
    const store = tx.objectStore("syncQueue")
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function removeSyncOperation(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["syncQueue"], "readwrite")
    const store = tx.objectStore("syncQueue")
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function markNoteSynced(db, clientId, serverId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["notes"], "readwrite")
    const store = tx.objectStore("notes")
    const getRequest = store.get(clientId)

    getRequest.onsuccess = () => {
      const note = getRequest.result
      if (note) {
        note.synced = true
        note.serverId = serverId
        const putRequest = store.put(note)
        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(putRequest.error)
      } else {
        resolve()
      }
    }
    getRequest.onerror = () => reject(getRequest.error)
  })
}

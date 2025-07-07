import React, { useState, useEffect, useCallback, useMemo } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  serverTimestamp,
  setLogLevel,
} from "firebase/firestore";

// --- Helper function to safely parse Firebase config ---
// This function is kept for future use when implementing dynamic config loading
const parseFirebaseConfig = (configString) => {
  try {
    if (!configString) return null;
    return JSON.parse(configString);
  } catch (error) {
    console.error("Failed to parse Firebase config:", error);
    return null;
  }
};

// --- Firebase Configuration ---
// For now, we'll use a placeholder config. You can replace this with your actual Firebase config
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
const appId = "stiffy-notes-app";

// --- Initialize Firebase ---
let app;
let auth;
let db;

if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  setLogLevel("debug");
} else {
  console.warn(
    "Firebase configuration is missing. App will not connect to Firebase."
  );
}

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [notes, setNotes] = useState([]);
  const [notebooks, setNotebooks] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState("all"); // 'all', 'uncategorized', or a notebook id
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // --- Authentication Effect ---
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      setError("Firebase is not configured.");
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        try {
          // For now, we'll just sign in anonymously
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Authentication failed:", err);
          setError("Could not authenticate user.");
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- Firestore Data Fetching ---
  useEffect(() => {
    if (!user || !db) return;

    // Fetch Notebooks
    const notebooksCollection = collection(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "notebooks"
    );
    const notebooksQuery = query(notebooksCollection);
    const unsubscribeNotebooks = onSnapshot(
      notebooksQuery,
      (snapshot) => {
        const notebooksData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        notebooksData.sort((a, b) => a.name.localeCompare(b.name));
        setNotebooks(notebooksData);
      },
      (err) => {
        console.error("Error fetching notebooks:", err);
        setError("Failed to load notebooks.");
      }
    );

    // Fetch Notes
    const notesCollection = collection(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "notes"
    );
    const notesQuery = query(notesCollection);
    const unsubscribeNotes = onSnapshot(
      notesQuery,
      (snapshot) => {
        const notesData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        notesData.sort(
          (a, b) =>
            (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0)
        );
        setNotes(notesData);
      },
      (err) => {
        console.error("Error fetching notes:", err);
        setError("Failed to load notes.");
      }
    );

    return () => {
      unsubscribeNotebooks();
      unsubscribeNotes();
    };
  }, [user]);

  // --- Filtered Notes Logic ---
  const filteredNotes = useMemo(() => {
    let notesToFilter = [...notes];

    // Filter by notebook
    if (selectedNotebookId === "uncategorized") {
      notesToFilter = notesToFilter.filter((note) => !note.notebookId);
    } else if (selectedNotebookId !== "all") {
      notesToFilter = notesToFilter.filter(
        (note) => note.notebookId === selectedNotebookId
      );
    }

    // Filter by search term
    if (searchTerm.trim() !== "") {
      const lowercasedTerm = searchTerm.toLowerCase();
      notesToFilter = notesToFilter.filter(
        (note) =>
          note.title.toLowerCase().includes(lowercasedTerm) ||
          note.content.toLowerCase().includes(lowercasedTerm)
      );
    }

    return notesToFilter;
  }, [notes, selectedNotebookId, searchTerm]);

  // --- Event Handlers ---
  const handleSelectNotebook = (notebookId) => {
    setSelectedNotebookId(notebookId);
    setActiveNote(null); // Deselect active note when changing notebook
  };

  const handleSelectNote = (note) => {
    setActiveNote(note);
  };

  const handleAddNotebook = async (notebookName) => {
    if (!user || !db || !notebookName.trim()) return;
    const newNotebook = {
      name: notebookName.trim(),
      createdAt: serverTimestamp(),
    };
    const notebooksCollection = collection(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "notebooks"
    );
    await addDoc(notebooksCollection, newNotebook);
  };

  const handleAddNote = async () => {
    if (!user || !db) return;
    const currentNotebookId =
      selectedNotebookId === "all" || selectedNotebookId === "uncategorized"
        ? null
        : selectedNotebookId;
    const newNote = {
      title: "New Note",
      content: "",
      notebookId: currentNotebookId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      const notesCollection = collection(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "notes"
      );
      const docRef = await addDoc(notesCollection, newNote);
      setActiveNote({ id: docRef.id, ...newNote });
    } catch (err) {
      console.error("Error adding note:", err);
      setError("Could not create a new note.");
    }
  };

  const handleSaveNote = useCallback(
    async (noteToSave) => {
      if (!user || !db || !noteToSave) return;
      const noteRef = doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "notes",
        noteToSave.id
      );
      await updateDoc(noteRef, {
        title: noteToSave.title,
        content: noteToSave.content,
        updatedAt: serverTimestamp(),
      });
    },
    [user]
  );

  const handleDeleteNote = async (noteId) => {
    if (!user || !db || !noteId) return;
    const noteRef = doc(
      db,
      "artifacts",
      appId,
      "users",
      user.uid,
      "notes",
      noteId
    );
    await deleteDoc(noteRef);
    if (activeNote?.id === noteId) {
      setActiveNote(null);
    }
  };

  // --- Render Logic ---
  if (loading)
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-xl">Loading...</div>
      </div>
    );
  if (error)
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="bg-red-500 p-4 rounded-lg">{error}</div>
      </div>
    );

  return (
    <div className="flex h-screen font-sans bg-gray-900 text-white">
      <Sidebar
        user={user}
        notebooks={notebooks}
        notes={filteredNotes}
        selectedNotebookId={selectedNotebookId}
        activeNoteId={activeNote?.id}
        onSelectNotebook={handleSelectNotebook}
        onAddNotebook={handleAddNotebook}
        onSelectNote={handleSelectNote}
        onAddNote={handleAddNote}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
      />
      <main className="flex-1 flex flex-col bg-gray-900">
        {activeNote ? (
          <NoteEditor
            key={activeNote.id}
            note={activeNote}
            onSave={handleSaveNote}
            onDelete={handleDeleteNote}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-24 w-24 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <h2 className="text-2xl">Select a note or create a new one</h2>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Sidebar Component ---
function Sidebar({
  user,
  notebooks,
  notes,
  selectedNotebookId,
  activeNoteId,
  onSelectNotebook,
  onAddNotebook,
  onSelectNote,
  onAddNote,
  searchTerm,
  setSearchTerm,
}) {
  const [newNotebookName, setNewNotebookName] = useState("");

  const handleAddNotebookSubmit = (e) => {
    e.preventDefault();
    onAddNotebook(newNotebookName);
    setNewNotebookName("");
  };

  return (
    <div className="w-1/3 max-w-xs border-r border-gray-700 flex flex-col bg-gray-800">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold text-indigo-400">Notes</h1>
        <p className="text-xs text-gray-500 truncate">User: {user?.uid}</p>
      </div>

      {/* Notebooks Section */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Notebooks</h2>
        <div className="space-y-1">
          <NotebookItem
            id="all"
            name="All Notes"
            selectedId={selectedNotebookId}
            onClick={onSelectNotebook}
          />
          {notebooks.map((nb) => (
            <NotebookItem
              key={nb.id}
              id={nb.id}
              name={nb.name}
              selectedId={selectedNotebookId}
              onClick={onSelectNotebook}
            />
          ))}
          <NotebookItem
            id="uncategorized"
            name="Uncategorized"
            selectedId={selectedNotebookId}
            onClick={onSelectNotebook}
          />
        </div>
        <form onSubmit={handleAddNotebookSubmit} className="mt-3 flex gap-2">
          <input
            type="text"
            value={newNotebookName}
            onChange={(e) => setNewNotebookName(e.target.value)}
            placeholder="New notebook..."
            className="flex-grow bg-gray-700 text-white text-sm rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="p-1.5 bg-indigo-600 rounded-md hover:bg-indigo-500 transition-colors"
          >
            +
          </button>
        </form>
      </div>

      {/* Notes List Section */}
      <div className="flex-grow flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-sm font-semibold text-gray-400">Notes</h2>
          <button
            onClick={onAddNote}
            className="p-2 h-7 w-7 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className="p-4 border-b border-gray-700">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search notes..."
            className="w-full bg-gray-700 text-white text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => onSelectNote(note)}
              className={`p-4 cursor-pointer border-l-4 ${
                activeNoteId === note.id
                  ? "border-indigo-400 bg-gray-900"
                  : "border-transparent hover:bg-gray-700/50"
              }`}
            >
              <h3 className="font-semibold truncate text-gray-200">
                {note.title || "Untitled Note"}
              </h3>
              <p className="text-sm text-gray-400 truncate">
                {note.content || "No content"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const NotebookItem = ({ id, name, selectedId, onClick }) => (
  <button
    onClick={() => onClick(id)}
    className={`w-full text-left text-sm px-3 py-1.5 rounded-md transition-colors ${
      selectedId === id
        ? "bg-indigo-600 text-white font-semibold"
        : "text-gray-300 hover:bg-gray-700"
    }`}
  >
    {name}
  </button>
);

// --- Note Editor Component ---
function NoteEditor({ note, onSave, onDelete }) {
  const [currentNote, setCurrentNote] = useState(note);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setCurrentNote(note);
  }, [note]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCurrentNote((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveClick = async () => {
    setIsSaving(true);
    await onSave(currentNote);
    setIsSaving(false);
  };

  const confirmDelete = () => {
    onDelete(currentNote.id);
    setShowDeleteConfirm(false);
  };

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-700 flex flex-wrap gap-4 justify-between items-center">
          <input
            type="text"
            name="title"
            value={currentNote.title}
            onChange={handleChange}
            className="text-2xl font-bold bg-transparent focus:outline-none flex-grow text-white"
            placeholder="Note Title"
          />
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSaveClick}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-500 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-green-400"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-full hover:bg-red-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-red-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
        <textarea
          name="content"
          value={currentNote.content}
          onChange={handleChange}
          className="flex-grow p-6 text-lg bg-transparent focus:outline-none resize-none text-gray-300 leading-relaxed"
          placeholder="Start writing..."
        />
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-xl font-bold text-red-400 mb-4">
              Delete Note?
            </h3>
            <p className="text-gray-300 mb-6">
              Are you sure you want to permanently delete this note?
            </p>
            <div className="flex justify-end gap-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 font-semibold text-gray-200 bg-gray-600 rounded-lg hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 font-semibold text-white bg-red-600 rounded-lg hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

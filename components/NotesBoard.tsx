import React, { useState, useEffect } from 'react';
import { Note, Task } from '../types';
import { 
  Plus, X, Check, Trash2, FileText, 
  CheckSquare, MoreHorizontal, Calendar, 
  Clock, ChevronRight, Search, File
} from 'lucide-react';

interface NotesBoardProps {
  notes: Note[];
  tasks: Task[];
  onUpdateNotes: (notes: Note[]) => void;
  onUpdateTasks: (tasks: Task[]) => void;
}

const ICON_COLORS = {
  yellow: 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30',
  blue: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
  green: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
  rose: 'text-rose-500 bg-rose-100 dark:bg-rose-900/30',
  violet: 'text-violet-500 bg-violet-100 dark:bg-violet-900/30',
  slate: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
};

export const NotesBoard: React.FC<NotesBoardProps> = ({ notes, tasks, onUpdateNotes, onUpdateTasks }) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Select first note on load if available and none selected
  useEffect(() => {
    if (!selectedNoteId && notes.length > 0) {
      setSelectedNoteId(notes[0].id);
    }
  }, []);

  const activeNote = notes.find(n => n.id === selectedNoteId);
  
  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // --- NOTES HANDLERS ---
  const handleAddNote = () => {
    const newNote: Note = {
      id: Date.now().toString(),
      title: '',
      content: '',
      color: 'slate', // Default icon color
      date: new Date().toISOString()
    };
    onUpdateNotes([newNote, ...notes]);
    setSelectedNoteId(newNote.id);
  };

  const handleUpdateNote = (id: string, field: keyof Note, value: any) => {
    onUpdateNotes(notes.map(n => n.id === id ? { ...n, [field]: value } : n));
  };

  const handleDeleteNote = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newNotes = notes.filter(n => n.id !== id);
    onUpdateNotes(newNotes);
    if (selectedNoteId === id) {
      setSelectedNoteId(newNotes.length > 0 ? newNotes[0].id : null);
    }
  };

  const cycleColor = (id: string, currentColor: string) => {
    const colors = Object.keys(ICON_COLORS) as Array<keyof typeof ICON_COLORS>;
    const idx = colors.indexOf(currentColor as any);
    const nextColor = colors[(idx + 1) % colors.length];
    handleUpdateNote(id, 'color', nextColor);
  };

  // --- TASKS HANDLERS ---
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    const newTask: Task = {
      id: Date.now().toString(),
      text: newTaskText,
      completed: false
    };
    onUpdateTasks([newTask, ...tasks]);
    setNewTaskText('');
  };

  const handleToggleTask = (id: string) => {
    onUpdateTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const handleDeleteTask = (id: string) => {
    onUpdateTasks(tasks.filter(t => t.id !== id));
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-140px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
      
      {/* 1. LEFT SIDEBAR: Note List */}
      <div className="w-full lg:w-64 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-950/50">
        
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
           <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
               <div className="w-5 h-5 bg-indigo-500 rounded text-white flex items-center justify-center text-xs">F</div>
               <span>Workspace</span>
             </div>
             <button 
               onClick={handleAddNote} 
               className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500 transition-colors"
               title="New Page"
             >
               <Plus className="w-4 h-4" />
             </button>
           </div>
           
           <div className="relative">
             <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-400" />
             <input 
               type="text" 
               placeholder="Search pages..." 
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 pl-8 pr-3 text-xs focus:ring-1 focus:ring-indigo-500 outline-none dark:text-slate-200"
             />
           </div>
        </div>

        {/* Page List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Private</div>
          
          {filteredNotes.map(note => (
            <div 
              key={note.id}
              onClick={() => setSelectedNoteId(note.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${selectedNoteId === note.id ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <div className="text-slate-400">
                <FileText className="w-4 h-4" />
              </div>
              <span className="truncate flex-1">
                {note.title || "Untitled"}
              </span>
              <button
                 onClick={(e) => handleDeleteNote(e, note.id)}
                 className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-rose-500 transition-all"
              >
                 <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {filteredNotes.length === 0 && (
             <div className="px-3 py-4 text-xs text-slate-400 italic text-center">
               {searchQuery ? 'No pages found' : 'No pages yet'}
             </div>
          )}
        </div>
      </div>

      {/* 2. CENTER PANEL: Editor */}
      <div className="flex-1 flex flex-col bg-white dark:bg-slate-900 relative">
         {activeNote ? (
           <div className="flex-1 flex flex-col h-full overflow-hidden animate-fadeIn">
              
              {/* Document Header (Cover/Icon/Title) */}
              <div className="pt-12 px-8 md:px-12 max-w-4xl mx-auto w-full flex-shrink-0">
                 {/* Icon Selector */}
                 <div className="group relative mb-6">
                    <button 
                      onClick={() => cycleColor(activeNote.id, activeNote.color)}
                      className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-sm transition-transform hover:scale-105 ${ICON_COLORS[activeNote.color]} cursor-pointer`}
                    >
                      <File className="w-8 h-8" />
                    </button>
                    <div className="absolute top-0 left-20 hidden group-hover:flex items-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                       Click icon to change color
                    </div>
                 </div>

                 {/* Title Input */}
                 <input
                    type="text"
                    value={activeNote.title}
                    onChange={(e) => handleUpdateNote(activeNote.id, 'title', e.target.value)}
                    placeholder="Untitled"
                    className="w-full text-4xl font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 border-none outline-none bg-transparent p-0 mb-4"
                 />
                 
                 {/* Metadata Row */}
                 <div className="flex items-center gap-6 text-xs text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
                    <div className="flex items-center gap-2">
                       <Calendar className="w-3.5 h-3.5" />
                       <span>Date created</span>
                       <span className="text-slate-600 dark:text-slate-300">{new Date(activeNote.date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <Clock className="w-3.5 h-3.5" />
                       <span>Last edited</span>
                       <span className="text-slate-600 dark:text-slate-300">Just now</span>
                    </div>
                 </div>
              </div>

              {/* Document Body */}
              <div className="flex-1 overflow-y-auto px-8 md:px-12 pb-12 max-w-4xl mx-auto w-full custom-scrollbar">
                 <textarea
                    value={activeNote.content}
                    onChange={(e) => handleUpdateNote(activeNote.id, 'content', e.target.value)}
                    placeholder="Type '/' for commands"
                    className="w-full h-full resize-none border-none outline-none bg-transparent text-base leading-7 text-slate-700 dark:text-slate-300 placeholder:text-slate-300 dark:placeholder:text-slate-700"
                    spellCheck={false}
                 />
              </div>
           </div>
         ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
              <FileText className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">Select a page to edit</p>
           </div>
         )}
      </div>

      {/* 3. RIGHT SIDEBAR: Tasks */}
      <div className="hidden xl:flex w-72 border-l border-slate-200 dark:border-slate-800 flex-col bg-slate-50/30 dark:bg-slate-950/30">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
           <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2">
             <CheckSquare className="w-4 h-4 text-slate-400" />
             To-do List
           </h3>
        </div>

        <div className="p-3">
          <form onSubmit={handleAddTask} className="relative">
             <Plus className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
             <input 
               type="text" 
               value={newTaskText}
               onChange={(e) => setNewTaskText(e.target.value)}
               placeholder="Add a task..."
               className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-2 pl-9 pr-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none dark:text-slate-200 shadow-sm"
             />
          </form>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {tasks.map(task => (
             <div key={task.id} className="group flex items-start gap-2 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors">
                <button
                   onClick={() => handleToggleTask(task.id)}
                   className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors ${task.completed ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`}
                >
                   {task.completed && <Check className="w-3 h-3" />}
                </button>
                <span className={`text-sm flex-1 leading-tight pt-0.5 ${task.completed ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700 dark:text-slate-300'}`}>
                   {task.text}
                </span>
                <button 
                  onClick={() => handleDeleteTask(task.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
             </div>
          ))}
          {tasks.length === 0 && (
             <div className="text-center py-8 text-xs text-slate-400">
                No tasks pending
             </div>
          )}
        </div>
      </div>

    </div>
  );
};

import React, { useState, useRef, useEffect } from 'react';
import { InventoryItem, ChatMessage } from '../types';
import { generateChatResponse } from '../services/geminiService';
import { OfflineError } from '../services/functionsGuard';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { Send, Bot, User, Loader2, Sparkles, Trash2, X, Maximize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AIChatViewProps {
  inventory: InventoryItem[];
  messages: ChatMessage[];
  onUpdateMessages: (msgs: ChatMessage[]) => void;
  variant?: 'full' | 'sidebar';
  onClose?: () => void;
}

export const AIChatView: React.FC<AIChatViewProps> = ({ 
  inventory, 
  messages, 
  onUpdateMessages, 
  variant = 'full',
  onClose
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // The AI Assistant runs entirely through the aiGenerate Cloud Function —
  // there's no offline queue behind it, so it's disabled outright rather
  // than appearing to send and then failing.
  const isOffline = useConnectionStatus() === 'offline';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, variant]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || isOffline) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    const newHistory = [...messages, userMsg];
    onUpdateMessages(newHistory);
    setInput('');
    setIsLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
    }

    try {
      // The inventory context, system instruction, and Gemini call all live
      // server-side in the `aiGenerate` callable now — no API key on the client.
      const aiText = await generateChatResponse(inventory, newHistory);

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: aiText,
        timestamp: new Date()
      };

      onUpdateMessages([...newHistory, aiMsg]);
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: error instanceof OfflineError
          ? "You're offline — the AI Assistant needs an internet connection."
          : "Sorry, I encountered an error connecting to the AI service. Please check your network or API key.",
        timestamp: new Date()
      };
      onUpdateMessages([...newHistory, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    onUpdateMessages([{
      id: 'welcome',
      role: 'model',
      text: "Chat cleared. I'm ready for new questions!",
      timestamp: new Date()
    }]);
  };

  const isSidebar = variant === 'sidebar';

  return (
    <div className={`flex flex-col bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden relative ${isSidebar ? 'h-full border-l' : 'h-[calc(100vh-140px)] border rounded-xl'}`}>
      
      {/* Header */}
      <div className={`px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center z-10 ${isSidebar ? 'bg-white dark:bg-slate-900' : ''}`}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg text-white shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">AI Assistant</h2>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              Gemini 2.5 Flash <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
            <button 
                onClick={clearChat}
                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                title="Clear Chat History"
            >
                <Trash2 className="w-4 h-4" />
            </button>
            {onClose && (
                <button 
                    onClick={onClose}
                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title="Close Sidebar"
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-slate-50/30 dark:bg-slate-950/30">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'model' && (
              <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0 border border-indigo-200 dark:border-indigo-800 mt-1">
                <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>
            )}
            
            <div 
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-br-none' 
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-bl-none'
              }`}
            >
              {msg.role === 'model' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-xs sm:text-sm">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-xs sm:text-sm">{msg.text}</p>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-1">
                <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" />
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-3">
             <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0 border border-indigo-200 dark:border-indigo-800">
                <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
             </div>
             <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-1.5">
               <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
               <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
               <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder={isOffline ? "Unavailable offline" : "Ask AI..."}
              disabled={isOffline}
              className="w-full pl-3 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 dark:text-slate-200 text-sm resize-none max-h-[100px] custom-scrollbar disabled:opacity-50 disabled:cursor-not-allowed"
              rows={1}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || isOffline}
            title={isOffline ? "Unavailable offline" : undefined}
            className={`p-2.5 rounded-xl flex-shrink-0 transition-all ${
                input.trim() && !isLoading && !isOffline
                 ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                 : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            }`}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {isOffline && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 text-center">
            You're offline — the AI Assistant needs an internet connection.
          </p>
        )}
      </div>
    </div>
  );
};

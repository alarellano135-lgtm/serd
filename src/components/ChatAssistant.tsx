import React, { useState, useEffect, useRef } from 'react';
import { sendChatToGemini, ChatTriageMessage } from '../lib/api';
import { useUserSettings } from '../lib/userSettings';
import { useAuth } from '../contexts/AuthContext';

interface ChatAssistantProps {
  initialMessage?: string;
  onBack: () => void;
  onNavigate?: (screen: string) => void;
  onTriggerSOS?: (serviceType?: string) => void;
}

interface Message {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  action?: string;
  actionType?: 'ambulance' | 'police' | 'fire' | 'call';
}

function parseActionTag(text: string): { cleanText: string; action?: string; actionType?: 'ambulance' | 'police' | 'fire' | 'call' } {
  const match = text.match(/\[ACTION:\s*([^\]]+)\]/i);
  if (!match) {
    return { cleanText: text };
  }
  const actionLabel = match[1].trim();
  const cleanText = text.replace(/\[ACTION:\s*([^\]]+)\]/i, '').trim();
  
  let actionType: 'ambulance' | 'police' | 'fire' | 'call' = 'ambulance';
  const lower = actionLabel.toLowerCase();
  if (lower.includes('police') || lower.includes('law') || lower.includes('patrol')) actionType = 'police';
  else if (lower.includes('fire') || lower.includes('rescue')) actionType = 'fire';
  else if (lower.includes('call') || lower.includes('hotline')) actionType = 'call';

  return { cleanText, action: actionLabel, actionType };
}

export default function ChatAssistant({ initialMessage, onBack, onNavigate, onTriggerSOS }: ChatAssistantProps) {
  const { settings } = useUserSettings();
  const { userProfile } = useAuth();
  const { profile, location } = settings;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: "Hello. I'm SERD Emergency Triage. I'm here to assess your situation and route immediate help. Are you or anyone nearby in immediate danger?",
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const hasSentInitialRef = useRef(false);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const executeSend = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend.trim()
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    // Format chat history for Gemini API
    const historyPayload: ChatTriageMessage[] = newMessages.map(m => ({
      role: m.sender === 'bot' ? 'assistant' : 'user',
      text: m.text
    }));

    const contextPayload = {
      callerName: userProfile?.fullName || profile?.fullName || profile?.displayName || 'Citizen',
      location: location?.lastKnownAddress || 'Current GPS coordinates',
      bloodType: userProfile?.bloodType || profile?.bloodType || 'Unknown',
      allergies: (userProfile?.allergies || profile?.allergies || []).map(a => typeof a === 'string' ? a : a.allergen)
    };

    const response = await sendChatToGemini(historyPayload, contextPayload);
    setIsLoading(false);

    const { cleanText, action, actionType } = parseActionTag(response.text);

    const botMsg: Message = {
      id: `bot-${Date.now()}`,
      sender: 'bot',
      text: cleanText,
      action,
      actionType
    };

    setMessages(prev => [...prev, botMsg]);
  };

  useEffect(() => {
    if (initialMessage && !hasSentInitialRef.current) {
      hasSentInitialRef.current = true;
      executeSend(initialMessage);
    }
  }, [initialMessage]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;
    const text = inputValue;
    setInputValue('');
    executeSend(text);
  };

  const handleExecuteAction = (actionType?: string) => {
    if (onTriggerSOS) {
      onTriggerSOS(actionType);
    } else if (onNavigate) {
      onNavigate('map');
    } else {
      onBack();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA] dark:bg-neutral-950 relative font-sans">
      {/* Header */}
      <div className="flex items-center justify-between p-3.5 px-5 bg-white dark:bg-neutral-900 z-10 shrink-0 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack} 
            className="text-neutral-700 dark:text-neutral-300 py-1 px-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-neutral-900 dark:text-neutral-100 font-bold text-sm leading-tight">Emergency Triage</h1>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Active</span>
            </div>
            <p className="text-neutral-500 dark:text-neutral-400 text-[11px]">Direct CAD guidance & symptom triage</p>
          </div>
        </div>

        <button
          onClick={() => handleExecuteAction('ambulance')}
          className="bg-[#B41A46] hover:bg-[#9a143a] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer"
        >
          Dispatch SOS
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
            <div className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 mb-1 px-1">
              {msg.sender === 'user' ? 'You' : 'Triage Dispatch'}
            </div>

            <div className={`rounded-xl p-3.5 max-w-[85%] sm:max-w-[75%] text-xs leading-relaxed ${
              msg.sender === 'user' 
                ? 'bg-[#B41A46] text-white' 
                : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100'
            }`}>
              <p className="whitespace-pre-wrap font-normal">
                {msg.text}
              </p>

              {msg.action && (
                <div className="mt-3 pt-2.5 border-t border-neutral-200 dark:border-neutral-800">
                  <button 
                    onClick={() => handleExecuteAction(msg.actionType)}
                    className="w-full py-2 px-3 bg-[#B41A46] hover:bg-[#9a143a] text-white font-bold text-xs rounded-lg transition-colors cursor-pointer text-center"
                  >
                    {msg.action}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex flex-col items-start">
            <div className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 mb-1 px-1">
              Triage Dispatch
            </div>
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-3 text-xs text-neutral-500 dark:text-neutral-400">
              Evaluating symptoms and routing protocol...
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Input Area */}
      <div className="p-3.5 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 shrink-0">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input 
            type="text" 
            placeholder="Describe what is happening..." 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            className="flex-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-xs text-neutral-900 dark:text-neutral-100 px-3.5 py-2.5 focus:outline-none focus:border-[#B41A46] focus:bg-white dark:focus:bg-neutral-900 transition-colors placeholder:text-neutral-400"
          />
          <button 
            type="submit"
            disabled={!inputValue.trim() || isLoading} 
            className="bg-[#B41A46] hover:bg-[#9a143a] text-white font-semibold text-xs px-4 py-2.5 rounded-xl transition-colors disabled:opacity-40 cursor-pointer shrink-0"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

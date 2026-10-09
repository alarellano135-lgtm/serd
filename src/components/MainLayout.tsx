import React from 'react';
import { Tab } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useUserSettings } from '../lib/userSettings';

interface MainLayoutProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onNavigate?: (screen: any) => void;
  children: React.ReactNode;
}

interface NavTabItem {
  id: Tab;
  label: string;
}

const NAV_ITEMS: NavTabItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'mapTab', label: 'Map' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'profile', label: 'Profile' },
];

export default function MainLayout({ activeTab, onTabChange, onNavigate, children }: MainLayoutProps) {
  const { userProfile } = useAuth();
  const { settings } = useUserSettings();
  const isResponder = userProfile?.role === 'responder' || settings.profile?.role === 'responder';

  return (
    <div className="flex flex-col h-full bg-[#FAFAFA] dark:bg-neutral-950 font-sans overflow-hidden transition-colors">
      {/* Top Navigation Bar */}
      <header className="shrink-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5 z-30">
        <div className="max-w-md mx-auto flex items-center gap-2">
          <nav className="flex-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-xl flex items-center gap-1 border border-neutral-200/70 dark:border-neutral-700/60">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs transition-all duration-150 text-center ${
                    isActive
                      ? 'bg-white dark:bg-neutral-900 text-[#B41A46] dark:text-rose-400 font-bold shadow-xs border border-neutral-200/60 dark:border-neutral-700'
                      : 'text-neutral-600 dark:text-neutral-400 font-medium hover:text-neutral-900 dark:hover:text-neutral-200'
                  }`}
                  aria-label={item.label}
                >
                  <span className="tracking-tight truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Quick Switcher for Verified Responders */}
          {isResponder && onNavigate && (
            <button
              onClick={() => onNavigate('responder')}
              className="py-1.5 px-3 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:hover:bg-neutral-200 text-white dark:text-neutral-900 rounded-xl text-xs font-bold border border-neutral-800 dark:border-neutral-200 transition-all cursor-pointer shrink-0"
              title="Open Responder Mobile CAD"
            >
              CAD Terminal
            </button>
          )}
        </div>
      </header>

      {/* Screen Content */}
      <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}

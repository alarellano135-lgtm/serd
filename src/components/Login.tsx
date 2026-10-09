import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface LoginProps {
  onNavigate: (screen: 'signup' | 'main' | 'responder') => void;
}

export default function Login({ onNavigate }: LoginProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      const userRole = result.profile?.role;
      if (userRole === 'responder') {
        onNavigate('responder');
      } else {
        onNavigate('main');
      }
    } else {
      setError(result.error || 'Failed to sign in.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-white px-6 py-12 relative overflow-y-auto font-sans">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto">
        <h1 className="text-4xl text-[#B41A46] mb-2 tracking-tight font-bold">SERD</h1>
        <p className="text-neutral-500 text-xs mb-8 font-medium tracking-wide">Emergency Response Dispatch</p>

        {error && (
          <div className="w-full mb-4 p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-rose-700 leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-neutral-600 uppercase tracking-wider mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] text-neutral-900 transition-colors text-sm font-medium placeholder:text-neutral-400"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-neutral-600 uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#B41A46] text-neutral-900 transition-colors text-sm font-medium placeholder:text-neutral-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-[#B41A46] hover:bg-[#9a143a] text-white font-semibold py-3 px-4 rounded-xl text-sm transition-colors cursor-pointer text-center disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-xs text-neutral-500">
          Don't have an account?{' '}
          <button onClick={() => onNavigate('signup')} className="text-[#B41A46] font-semibold hover:underline cursor-pointer">
            Create account
          </button>
        </p>
      </div>
    </div>
  );
}

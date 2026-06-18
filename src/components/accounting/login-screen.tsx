'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, LogIn, AlertCircle, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore, type AuthUser } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';

// ─── Red Curtain Particles ──────────────────────────────────────
function CurtainParticles() {
  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    delay: Math.random() * 3,
    duration: Math.random() * 4 + 3,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white/20"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.6, 0.2],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ─── Islamic Geometric Star Pattern ──────────────────────────────
function StarPattern({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="starPattern" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M25 0L30 20L50 25L30 30L25 50L20 30L0 25L20 20Z" fill="currentColor" opacity="0.08"/>
          <path d="M25 10L28 22L40 25L28 28L25 40L22 28L10 25L22 22Z" fill="currentColor" opacity="0.06"/>
        </pattern>
      </defs>
      <rect width="200" height="200" fill="url(#starPattern)"/>
    </svg>
  );
}

// ─── Red Curtain Animation ──────────────────────────────────────
function RedCurtain({ opened, onClick }: { opened: boolean; onClick: () => void }) {
  return (
    <AnimatePresence>
      {!opened && (
        <div className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer" onClick={onClick}>
          {/* Left curtain panel */}
          <motion.div
            className="absolute top-0 left-0 h-full w-1/2 overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #8B0000 0%, #B22222 30%, #DC143C 50%, #B22222 70%, #8B0000 100%)',
            }}
            initial={{ x: 0 }}
            exit={{ x: '-105%' }}
            transition={{ duration: 1.2, ease: [0.76, 0, 0.24, 1] }}
          >
            <div className="absolute inset-0">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full"
                  style={{
                    left: `${i * 14}%`,
                    width: '14%',
                    background: `linear-gradient(90deg, transparent 0%, rgba(0,0,0,${0.15 + (i % 2) * 0.1}) 50%, transparent 100%)`,
                  }}
                />
              ))}
            </div>
            <div className="absolute top-0 right-0 h-full w-1 bg-yellow-500/50" />
            <div className="absolute bottom-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-600/40 via-yellow-400/60 to-yellow-600/40" />
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-600/40 via-yellow-400/60 to-yellow-600/40" />
            <div className="absolute bottom-2 right-2 flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="flex gap-0.5 mt-0.5">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-0.5 h-4 bg-yellow-600/60 rounded-full" />
                ))}
              </div>
            </div>
          </motion.div>

          {/* Right curtain panel */}
          <motion.div
            className="absolute top-0 right-0 h-full w-1/2 overflow-hidden"
            style={{
              background: 'linear-gradient(225deg, #8B0000 0%, #B22222 30%, #DC143C 50%, #B22222 70%, #8B0000 100%)',
            }}
            initial={{ x: 0 }}
            exit={{ x: '105%' }}
            transition={{ duration: 1.2, ease: [0.76, 0, 0.24, 1] }}
          >
            <div className="absolute inset-0">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full"
                  style={{
                    left: `${i * 14}%`,
                    width: '14%',
                    background: `linear-gradient(90deg, transparent 0%, rgba(0,0,0,${0.15 + (i % 2) * 0.1}) 50%, transparent 100%)`,
                  }}
                />
              ))}
            </div>
            <div className="absolute top-0 left-0 h-full w-1 bg-yellow-500/50" />
            <div className="absolute bottom-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-600/40 via-yellow-400/60 to-yellow-600/40" />
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-600/40 via-yellow-400/60 to-yellow-600/40" />
            <div className="absolute bottom-2 left-2 flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="flex gap-0.5 mt-0.5">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-0.5 h-4 bg-yellow-600/60 rounded-full" />
                ))}
              </div>
            </div>
          </motion.div>

          {/* Center emblem - star/ornament */}
          <motion.div
            className="relative z-10 flex flex-col items-center"
            initial={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            <motion.div
              className="relative"
              animate={{ rotate: 360 }}
              transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
            >
              <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow-2xl">
                <defs>
                  <radialGradient id="starGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#FFD700" />
                    <stop offset="50%" stopColor="#FFA500" />
                    <stop offset="100%" stopColor="#B8860B" />
                  </radialGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                      <feMergeNode in="coloredBlur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>
                <polygon
                  points="60,5 70,45 110,45 78,68 88,108 60,85 32,108 42,68 10,45 50,45"
                  fill="url(#starGrad)"
                  filter="url(#glow)"
                />
                <polygon
                  points="60,25 66,48 88,48 70,60 76,83 60,72 44,83 50,60 32,48 54,48"
                  fill="#DC143C"
                  opacity="0.9"
                />
                <circle cx="60" cy="60" r="12" fill="#FFD700" />
                <circle cx="60" cy="60" r="8" fill="#DC143C" />
                <circle cx="60" cy="60" r="4" fill="#FFD700" />
              </svg>
            </motion.div>

            <motion.div
              className="mt-6 text-center"
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <p className="text-2xl font-bold text-yellow-300 drop-shadow-lg" style={{ textShadow: '0 0 20px rgba(255,215,0,0.5)' }}>
                مرحباً بك
              </p>
              <p className="text-sm text-yellow-200/70 mt-1">انقر لفتح الستار</p>
              <p className="text-xs text-yellow-200/50 mt-0.5">Click to open</p>
            </motion.div>
          </motion.div>

          {/* Top valance */}
          <motion.div
            className="absolute top-0 left-0 w-full z-20"
            style={{
              height: '60px',
              background: 'linear-gradient(180deg, #5C0000 0%, #8B0000 40%, #B22222 100%)',
            }}
            initial={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          >
            <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gradient-to-r from-yellow-800 via-yellow-400 to-yellow-800" />
            <div className="absolute -bottom-3 left-0 w-full flex justify-center">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="w-12 h-6 rounded-b-full bg-gradient-to-b from-yellow-600/60 to-yellow-800/40 -mx-1" />
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ─── Login Form ──────────────────────────────────────────────────
function LoginForm({ dir }: { dir: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const { login } = useAppStore();

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Call our custom login endpoint directly
      // credentials: 'include' ensures the session cookie is accepted and stored
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (data.success && data.user) {
        // Save user + token to Zustand (which persists to localStorage)
        // The token is also saved separately for the API interceptor
        login(data.user as AuthUser, data.token);
        // The AppContent component will detect isAuthenticated=true and show the dashboard
      } else {
        setError(data.error || 'بيانات الدخول غير صحيحة');
      }
    } catch (err: any) {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [email, password, login]);

  return (
    <motion.div
      dir={dir}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
      className="w-full max-w-md mx-auto"
    >
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-xl shadow-2xl">
        {/* Card header with gradient */}
        <div className="relative px-8 pt-8 pb-4 bg-gradient-to-br from-red-900/80 via-red-800/60 to-red-900/80 overflow-hidden">
          <StarPattern className="absolute inset-0 w-full h-full text-yellow-400/30" />
          <div className="relative z-10 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.5 }}
              className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg shadow-yellow-500/30"
            >
              <Lock className="w-8 h-8 text-red-900" />
            </motion.div>
            <h1 className="text-2xl font-bold text-white">{t.loginTitle || 'تسجيل الدخول'}</h1>
            <p className="text-red-200/70 text-sm mt-1">{t.loginSubtitle || 'أدخل بيانات حسابك للوصول إلى النظام'}</p>
          </div>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Email field */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Mail className="w-4 h-4" />
              {t.email || 'البريد الإلكتروني'}
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className="h-11 bg-background/50 border-border/50 focus:border-primary transition-colors"
              required
              autoComplete="email"
            />
          </div>

          {/* Password field */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Lock className="w-4 h-4" />
              {t.password || 'كلمة المرور'}
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 bg-background/50 border-border/50 focus:border-primary transition-colors pe-10"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit button */}
          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-gradient-to-r from-red-800 to-red-600 hover:from-red-700 hover:to-red-500 text-white font-semibold shadow-lg shadow-red-900/30 transition-all duration-300 hover:shadow-red-800/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
              />
            ) : (
              <>
                <LogIn className="w-4 h-4 me-2" />
                {t.loginButton || 'تسجيل الدخول'}
              </>
            )}
          </Button>
        </form>

        {/* Footer */}
        <div className="px-8 pb-6 text-center">
          <p className="text-xs text-muted-foreground">
            {t.loginFooter || 'نظام المحاسبة والإدارة المالية'} © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Login Screen ──────────────────────────────────────────
export default function LoginScreen() {
  const [curtainOpened, setCurtainOpened] = useState(false);
  const { locale } = useAppStore();
  const { t } = useTranslation();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <div dir={dir} className="fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      {/* Animated background */}
      <div className="absolute inset-0">
        <CurtainParticles />
        <motion.div
          className="absolute top-1/4 -start-20 w-72 h-72 rounded-full bg-red-900/20 blur-3xl"
          animate={{ scale: [1, 1.2, 1], x: [0, 20, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 -end-20 w-72 h-72 rounded-full bg-red-800/15 blur-3xl"
          animate={{ scale: [1.2, 1, 1.2], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-yellow-600/5 blur-3xl"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Login form (visible behind curtain) */}
      <div className="relative z-10 w-full max-w-md px-4">
        <LoginForm dir={dir} />
      </div>

      {/* Red curtain overlay */}
      <RedCurtain opened={curtainOpened} onClick={() => setCurtainOpened(true)} />

      {/* App branding in corner */}
      <motion.div
        className="absolute bottom-4 left-4 z-30 text-xs text-muted-foreground/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
      >
        {t.appName || 'نظام المحاسبة'}
      </motion.div>
    </div>
  );
}

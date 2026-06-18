import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
          include: { permissions: true },
        });

        if (!user) {
          return null;
        }

        if (!user.isActive) {
          return null;
        }

        const isValidPassword = await bcrypt.compare(credentials.password, user.password);
        if (!isValidPassword) {
          return null;
        }

        // Return user with permissions
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          nameEn: user.nameEn ?? undefined,
          role: user.role,
          allowedBranches: user.allowedBranches, // JSON string or null
          permissions: user.permissions.map((p) => ({
            screen: p.screen,
            accessLevel: p.accessLevel,
          })),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as Record<string, unknown>).role as string;
        token.nameEn = (user as unknown as Record<string, unknown>).nameEn as string;
        token.allowedBranches = (user as unknown as Record<string, unknown>).allowedBranches as string | null;
        token.permissions = (user as unknown as Record<string, unknown>).permissions as { screen: string; accessLevel: string }[];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as Record<string, unknown>).id = token.id;
        (session.user as unknown as Record<string, unknown>).role = token.role;
        (session.user as unknown as Record<string, unknown>).nameEn = token.nameEn;
        (session.user as unknown as Record<string, unknown>).allowedBranches = token.allowedBranches;
        (session.user as unknown as Record<string, unknown>).permissions = token.permissions;
      }
      return session;
    },
  },
  pages: {
    signIn: '/', // We handle login in-page
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      // Use __Secure- prefix in production for extra security ( browsers require HTTPS )
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',  // 'lax' works for same-origin (Render serves frontend + API from same domain)
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    callbackUrl: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.callback-url' : 'next-auth.callback-url',
      options: {
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    csrfToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.csrf-token' : 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
};

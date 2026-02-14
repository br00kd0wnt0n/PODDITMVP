import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import prisma from './db';

// ──────────────────────────────────────────────
// TEMPORARY AUTH: Email + Access Code
// Replace with magic link (Nodemailer provider) once
// domain is verified in SendGrid.
// ──────────────────────────────────────────────

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: 'Access Code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Access Code', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const email = (credentials?.email as string)?.trim().toLowerCase();
          const code = credentials?.code as string;

          if (!email || !code) {
            console.log('[Auth] Missing email or code');
            return null;
          }

          // Validate access code
          if (!process.env.ACCESS_CODE) {
            console.error('[Auth] ACCESS_CODE env var is not set!');
            return null;
          }
          if (code !== process.env.ACCESS_CODE) {
            console.log(`[Auth] Invalid access code for ${email}`);
            return null;
          }

          // Find or create user by email
          let user = await prisma.user.findUnique({ where: { email } });
          if (!user) {
            user = await prisma.user.create({
              data: { email, emailVerified: new Date() },
            });
            console.log(`[Auth] New user created: ${email} (${user.id})`);
          } else {
            console.log(`[Auth] Existing user signed in: ${email} (${user.id})`);
          }

          return { id: user.id, email: user.email, name: user.name };
        } catch (error) {
          console.error('[Auth] authorize error:', error);
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    jwt({ token, user }) {
      // On first sign-in, persist the DB user ID into the JWT
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      // Expose userId on session.user so API routes can use it
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
  },
});

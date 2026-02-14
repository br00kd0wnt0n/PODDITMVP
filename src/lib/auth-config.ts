import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import prisma from './db';

// ──────────────────────────────────────────────
// TEMPORARY AUTH: Email + Access Code
// Replace with magic link (Nodemailer provider) once
// domain is verified in SendGrid.
// ──────────────────────────────────────────────

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'Access Code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Access Code', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string)?.trim().toLowerCase();
        const code = credentials?.code as string;

        if (!email || !code) return null;

        // Validate access code
        if (code !== process.env.ACCESS_CODE) {
          return null;
        }

        // Find or create user by email
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({
            data: { email, emailVerified: new Date() },
          });
          console.log(`[Auth] New user created: ${email} (${user.id})`);
        }

        return { id: user.id, email: user.email, name: user.name };
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

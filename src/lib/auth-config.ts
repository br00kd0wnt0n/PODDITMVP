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

          // Look up existing user first
          let user = await prisma.user.findUnique({ where: { email } });

          // Check if access is revoked
          if (user?.revokedAt) {
            console.log(`[Auth] Revoked user attempted sign-in: ${email}`);
            return null;
          }

          // Validate access code: per-user invite code OR global fallback
          const validCode =
            (user?.inviteCode && code === user.inviteCode) ||
            (process.env.ACCESS_CODE && code === process.env.ACCESS_CODE);

          if (!validCode) {
            console.log(`[Auth] Invalid access code for ${email}`);
            return null;
          }

          // Create user if they don't exist (global code flow)
          let isFirstSignIn = false;
          if (!user) {
            user = await prisma.user.create({
              data: {
                email,
                emailVerified: new Date(),
                consentedAt: new Date(),
                consentChannel: 'signin',
              },
            });
            isFirstSignIn = true;
            console.log(`[Auth] New user created: ${email} (${user.id})`);
          } else {
            // Mark email verified + consent on first sign-in if invited via admin
            const updates: Record<string, unknown> = {};
            if (!user.emailVerified) updates.emailVerified = new Date();
            if (!user.consentedAt) {
              updates.consentedAt = new Date();
              updates.consentChannel = 'signin';
              isFirstSignIn = true;
            }
            if (Object.keys(updates).length > 0) {
              await prisma.user.update({ where: { id: user.id }, data: updates });
            }
            console.log(`[Auth] Existing user signed in: ${email} (${user.id})`);
          }

          // Ensure EmailPreferences exist + fire welcome email on first sign-in
          if (isFirstSignIn) {
            // Create email preferences (fire-and-forget)
            prisma.emailPreferences.upsert({
              where: { userId: user.id },
              create: { userId: user.id },
              update: {},
            }).catch(err => console.error('[Auth] Failed to create email preferences:', err));

            // Fire welcome email (fire-and-forget, gated by ENGAGEMENT_ENABLED)
            import('./engagement/flags').then(({ isEngagementEnabled }) => {
              if (!isEngagementEnabled()) return;
              import('./engagement/sequences').then(({ sendWelcomeEmail }) => {
                sendWelcomeEmail(user!.id).catch(err =>
                  console.error('[Auth] Failed to send welcome email:', err)
                );
              });
            }).catch(err => console.error('[Auth] Failed to check engagement flag:', err));
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

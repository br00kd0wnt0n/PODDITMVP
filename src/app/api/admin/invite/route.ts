import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import { sendInviteEmail, sendRevokeEmail, generateInviteCode } from '@/lib/email';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/admin/invite
// Grant access: create user with unique invite code, send email
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { email, name } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existing) {
      // User already exists — if they were revoked, re-invite them
      if (existing.revokedAt) {
        const inviteCode = generateInviteCode();
        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: {
            inviteCode,
            invitedAt: new Date(),
            revokedAt: null,
            name: name || existing.name,
          },
          select: { id: true, email: true, name: true, inviteCode: true },
        });

        // Send invite email
        const emailResult = await sendInviteEmail({
          to: normalizedEmail,
          name: name || existing.name || undefined,
          inviteCode,
        });

        return NextResponse.json({
          action: 'reinvited',
          user: updated,
          emailSent: emailResult.success,
        });
      }

      // Already active — if they don't have an invite code, generate one and resend
      if (!existing.inviteCode) {
        const inviteCode = generateInviteCode();
        await prisma.user.update({
          where: { id: existing.id },
          data: { inviteCode, invitedAt: new Date() },
        });

        const emailResult = await sendInviteEmail({
          to: normalizedEmail,
          name: name || existing.name || undefined,
          inviteCode,
        });

        return NextResponse.json({
          action: 'code_assigned',
          emailSent: emailResult.success,
        });
      }

      // Already has code — resend the existing code
      const emailResult = await sendInviteEmail({
        to: normalizedEmail,
        name: name || existing.name || undefined,
        inviteCode: existing.inviteCode,
      });

      return NextResponse.json({
        action: 'resent',
        emailSent: emailResult.success,
      });
    }

    // New user — create with invite code
    const inviteCode = generateInviteCode();
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name || null,
        inviteCode,
        invitedAt: new Date(),
        userType: 'EARLY_ACCESS',
      },
      select: { id: true, email: true, name: true, inviteCode: true },
    });

    console.log(`[Admin] Invited new user: ${normalizedEmail} (code: ${inviteCode})`);

    // Send invite email
    const emailResult = await sendInviteEmail({
      to: normalizedEmail,
      name: name || undefined,
      inviteCode,
    });

    return NextResponse.json({
      action: 'invited',
      user,
      emailSent: emailResult.success,
    });
  } catch (error: any) {
    console.error('[Admin] Invite error:', error);
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
  }
}

// ──────────────────────────────────────────────
// DELETE /api/admin/invite
// Revoke access: set revokedAt, clear invite code
// ──────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, revokedAt: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.revokedAt) {
      return NextResponse.json({ error: 'User already revoked' }, { status: 409 });
    }

    // Revoke: set timestamp and clear invite code
    await prisma.user.update({
      where: { id: userId },
      data: {
        revokedAt: new Date(),
        inviteCode: null,
      },
    });

    console.log(`[Admin] Revoked access for ${user.email}`);

    // Send notification email
    if (user.email) {
      await sendRevokeEmail({
        to: user.email,
        name: user.name || undefined,
      });
    }

    return NextResponse.json({ success: true, revoked: user.email });
  } catch (error: any) {
    console.error('[Admin] Revoke error:', error);
    return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 });
  }
}

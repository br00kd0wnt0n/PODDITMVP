import { redirect } from 'next/navigation';

// Verify page is not needed with access code auth.
// Redirect to sign-in in case anyone hits this URL.
export default function VerifyPage() {
  redirect('/auth/signin');
}

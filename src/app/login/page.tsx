import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { currentUser } from '@/lib/auth';
import { ready } from '@/lib/db';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  await ready();
  if (await currentUser()) redirect('/');

  // Si no hay ninguna cuenta todavia, el formulario abre directamente en modo
  // registro: en una instalacion nueva no hay nada con lo que iniciar sesion.
  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text FROM users`;

  return <AuthForm firstRun={Number(count) === 0} />;
}

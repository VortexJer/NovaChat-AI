import { redirect } from 'next/navigation';

import { App } from '@/components/App';
import { currentUser } from '@/lib/auth';
import { ready } from '@/lib/db';

// La sesion se lee en cada peticion, asi que nada de esta pagina es cacheable.
export const dynamic = 'force-dynamic';

export default async function Home() {
  // Primer contacto con la base de datos del proceso: crea el esquema si hace
  // falta, antes de que nadie intente iniciar sesion.
  await ready();

  const user = await currentUser();
  if (!user) redirect('/login');

  return <App user={user} />;
}

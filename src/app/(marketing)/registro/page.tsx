import { redirect } from 'next/navigation'

// Registro self-serve cerrado: la creacion de usuarios esta centralizada en MeTRIK.
// Cualquier acceso a /registro se redirige al login.
export default function RegistroPage() {
  redirect('/login')
}

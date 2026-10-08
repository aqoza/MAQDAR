import { redirect } from 'next/navigation'

// The proxy sends anonymous visitors to /login before this renders.
export default function Home() {
  redirect('/dashboard')
}

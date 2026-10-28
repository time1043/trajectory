import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { DevTools } from 'jotai-devtools'
import 'jotai-devtools/styles.css'

const RootLayout = () => (
  <>
    <div className="flex gap-2 p-2">
      <Link to="/" className="[&.active]:font-bold">
        Home
      </Link>{' '}
      <Link to="/about" className="[&.active]:font-bold">
        About
      </Link>
    </div>
    <hr />
    <Outlet />
    <DevTools />
    <TanStackRouterDevtools />
  </>
)

export const Route = createRootRoute({ component: RootLayout })

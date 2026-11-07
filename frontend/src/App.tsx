import { BrowserRouter as Router, Routes, Route, Link, NavLink as RRNavLink } from 'react-router-dom';
import Home from './pages/Home';
import Investigation from './pages/Investigation';
import History from './pages/History';

function NavLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <RRNavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-50 text-blue-700 border border-blue-100'
            : 'text-gray-600 hover:text-blue-600 hover:bg-gray-50 border border-transparent'
        }`
      }
      aria-current="page"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </RRNavLink>
  );
}

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2"
              aria-label="FlakeTrail home"
            >
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-200">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <span className="font-bold text-lg tracking-tight">FlakeTrail<span className="text-blue-600">.</span>ai</span>
            </Link>

            <div className="ml-auto hidden md:flex items-center gap-1">
              <NavLink to="/" label="Home" icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 011 1M7 20h4v-2H7zm0 0V8m0 0l-2 2m2 2l2-2" /></svg>} />
              <NavLink to="/history" label="History" icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
            </div>
          </div>
        </nav>

        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/investigate/:incidentId" element={<Investigation />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

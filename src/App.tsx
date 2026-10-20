import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import Dashboard from './pages/Dashboard';
import NewCall from './pages/NewCall';
import LiveCall from './pages/LiveCall';
import CallHistory from './pages/CallHistory';
import CallDetails from './pages/CallDetails';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new-call" element={<NewCall />} />
        <Route path="/call/:id" element={<LiveCall />} />
        <Route path="/history" element={<CallHistory />} />
        <Route path="/calls/:id" element={<CallDetails />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

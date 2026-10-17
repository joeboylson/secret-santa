import { Route, Routes } from 'react-router'
import { RequireAuth } from '@/lib/auth'
import AuthPage from '@/pages/AuthPage'
import EventPage from '@/pages/EventPage'
import GroupPage from '@/pages/GroupPage'
import HomePage from '@/pages/HomePage'
import JoinPage from '@/pages/JoinPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
      <Route path="/join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
      <Route path="/g/:groupId" element={<RequireAuth><GroupPage /></RequireAuth>} />
      <Route path="/e/:eventId" element={<RequireAuth><EventPage /></RequireAuth>} />
    </Routes>
  )
}

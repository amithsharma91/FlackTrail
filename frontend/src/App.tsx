import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import Home from './pages/Home';
import Investigation from './pages/Investigation';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/investigate/:incidentId" element={<Investigation />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;

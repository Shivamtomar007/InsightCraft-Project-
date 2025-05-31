import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Sun, Moon, LogOut, Save, Trash2 } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import './App.css';

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'en';
const db = getFirestore(app);

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const App = () => {
  const [theme, setTheme] = useState('light');
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('Startup');
  const [input, setInput] = useState('');
  const [insightType, setInsightType] = useState('SWOT Analysis');
  const [insights, setInsights] = useState(null);
  const [savedInsights, setSavedInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const barChartRef = useRef(null);
  const pieChartRef = useRef(null);

  // Handle Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const querySnapshot = await getDocs(collection(db, `users/${currentUser.uid}/insights`));
          const insightsList = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp.toDate()
          }));
          setSavedInsights(insightsList);
        } catch (error) {
          console.error("Error fetching insights:", error);
          setError('Failed to load saved insights. Please refresh the page.');
        }
      } else {
        setSavedInsights([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google Login Error:", error);
      setError('Failed to login with Google. Please try again.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign Out Error:", error);
      setError('Failed to sign out. Please try again.');
    }
  };

  const saveInsight = async () => {
    if (!user || !insights) return;
    try {
      const docRef = await addDoc(collection(db, `users/${user.uid}/insights`), {
        insightType,
        input,
        mode,
        swot: insights.swot,
        chartData: insights.chartData,
        timestamp: new Date(),
      });
      
      setSavedInsights(prev => [
        ...prev,
        {
          id: docRef.id,
          insightType,
          input,
          mode,
          swot: insights.swot,
          chartData: insights.chartData,
          timestamp: new Date()
        }
      ]);
      
      alert('Insight saved successfully!');
    } catch (error) {
      console.error("Error saving insight:", error);
      setError('Failed to save insight. Please try again.');
    }
  };

  const deleteInsight = async (insightId) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/insights`, insightId));
      setSavedInsights(prev => prev.filter(insight => insight.id !== insightId));
      alert('Insight deleted successfully!');
    } catch (error) {
      console.error("Error deleting insight:", error);
      setError('Failed to delete insight. Please try again.');
    }
  };

  const loadInsight = (insight) => {
    setInsightType(insight.insightType);
    setInput(insight.input);
    setMode(insight.mode || 'Startup');
    setInsights({
      swot: insight.swot,
      chartData: insight.chartData
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const generateInsights = async () => {
    if (!input) {
      setError('Please enter a description.');
      return;
    }
    if (input.length < 10) {
      setError('Please enter a more detailed description (at least 10 characters).');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `Generate a detailed ${insightType} for: "${input}". 
        Format the response EXACTLY like this:
        
        ## Strengths
        - Strength 1
        - Strength 2
        
        ## Weaknesses
        - Weakness 1
        
        ## Opportunities
        - Opportunity 1
        - Opportunity 2
        
        ## Threats
        - Threat 1`;
      
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      const parseSection = (sectionName) => {
        const sectionRegex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?:##|$)`);
        const match = text.match(sectionRegex);
        if (!match) return [];
        
        return match[1].split('\n')
          .filter(line => line.trim().startsWith('-'))
          .map(item => item.replace(/^- /, '').trim())
          .filter(Boolean);
      };

      const swot = {
        Strengths: parseSection('Strengths'),
        Weaknesses: parseSection('Weaknesses'),
        Opportunities: parseSection('Opportunities'),
        Threats: parseSection('Threats')
      };

      if (Object.values(swot).every(arr => arr.length === 0)) {
        throw new Error("Failed to parse insights. The response format may have changed.");
      }

      const chartData = [
        { name: 'Strengths', value: Math.max(swot.Strengths.length, 1) * 10 },
        { name: 'Weaknesses', value: Math.max(swot.Weaknesses.length, 1) * 10 },
        { name: 'Opportunities', value: Math.max(swot.Opportunities.length, 1) * 10 },
        { name: 'Threats', value: Math.max(swot.Threats.length, 1) * 10 }
      ].filter(item => item.value > 0);

      setInsights({ swot, chartData });

    } catch (error) {
      console.error("Generation Error:", error);
      setError(error.message || "Failed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const exportPDF = async () => {
    if (!insights) return;
    
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const margin = 15;
    let y = margin;
    
    // Add title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("InsightCraft Report", margin, y);
    y += 10;

    // Add metadata
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Insight Type: ${insightType}`, margin, y);
    y += 7;
    doc.text(`Mode: ${mode}`, margin, y);
    y += 7;
    doc.text(`Description: ${input}`, margin, y);
    y += 10;

    // Add SWOT analysis
    const splitText = (text, maxWidth) => doc.splitTextToSize(text, maxWidth - margin * 2);

    Object.entries(insights.swot).forEach(([key, values]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${key}:`, margin, y);
      y += 7;
      
      doc.setFont("helvetica", "normal");
      values.forEach((item) => {
        const lines = splitText(`• ${item}`, 180);
        lines.forEach((line) => {
          if (y > 270) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin + 5, y);
          y += 7;
        });
      });
      y += 5;
    });

    // Add charts with improved resolution
    const addChartToPDF = async (chartRef, title) => {
      try {
        // Create a temporary container with larger dimensions for high-res capture
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.width = '800px';
        tempContainer.style.height = '600px';
        tempContainer.style.backgroundColor = theme === 'dark' ? '#1f2937' : '#ffffff';
        document.body.appendChild(tempContainer);

        // Clone the chart with larger dimensions
        const chartClone = chartRef.current.cloneNode(true);
        chartClone.style.width = '800px';
        chartClone.style.height = '600px';
        tempContainer.appendChild(chartClone);

        // Wait for the clone to render
        await new Promise(resolve => setTimeout(resolve, 500));

        const canvas = await html2canvas(tempContainer, {
          scale: 3,
          logging: false,
          useCORS: true,
          backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff'
        });
        
        // Clean up
        document.body.removeChild(tempContainer);

        if (y > 150) {
          doc.addPage();
          y = margin;
        }
        
        const imgData = canvas.toDataURL('image/png', 1.0);
        const imgWidth = 180;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 7;
        
        doc.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
        y += imgHeight + 10;
        
      } catch (err) {
        console.error("Error generating chart image:", err);
      }
    };

    await addChartToPDF(barChartRef, "SWOT Analysis Bar Chart");
    await addChartToPDF(pieChartRef, "SWOT Analysis Pie Chart");

    doc.save('InsightCraft_Report.pdf');
  };

  return (
    <div className={`min-h-screen ${theme === 'light' ? 'bg-gray-100 text-gray-900' : 'bg-gray-900 text-white'} font-inter transition-colors duration-300`}>
      {/* Header */}
      <header className="p-4 flex justify-between items-center">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-poppins font-bold text-indigo-600"
        >
          InsightCraft
        </motion.h1>
        <div className="flex items-center space-x-4">
          {user ? (
            <div className="flex items-center space-x-2">
              <span className="text-sm">{user.displayName}</span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                onClick={handleSignOut}
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <LogOut size={24} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.05 }}
              onClick={handleGoogleLogin}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Login with Google
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.05 }}
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {theme === 'light' ? <Moon size={24} /> : <Sun size={24} />}
          </motion.button>
        </div>
      </header>

      {/* Error Message */}
      {error && (
        <div className="max-w-5xl mx-auto px-4">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <span className="block sm:inline">{error}</span>
            <button 
              className="absolute top-0 bottom-0 right-0 px-4 py-3" 
              onClick={() => setError(null)}
            >
              <svg className="fill-current h-6 w-6 text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <title>Close</title>
                <path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-5xl mx-auto p-4">
        {/* Prompt Dashboard */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`${theme === 'light' ? 'bg-white text-gray-800' : 'bg-gray-800 text-white'} rounded-lg shadow-lg p-6 mb-6`}
        >
          <h2 className="text-2xl font-poppins font-semibold mb-4">Insight Builder</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Select Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className={`w-full p-2 border rounded-lg ${theme === 'light' ? 'bg-white' : 'bg-gray-700'} border-gray-300`}
              >
                <option>Startup</option>
                <option>Content Creator</option>
                <option>Marketing Strategist</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Insight Type</label>
              <select
                value={insightType}
                onChange={(e) => setInsightType(e.target.value)}
                className={`w-full p-2 border rounded-lg ${theme === 'light' ? 'bg-white' : 'bg-gray-700'} border-gray-300`}
              >
                <option>SWOT Analysis</option>
                <option>Product Ideas</option>
                <option>Market Trends</option>
              </select>
            </div>
          </div>
          <label className="block text-sm font-medium mt-4 mb-2">Business Description</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g., I want to build an edtech startup focused on coding for kids."
            className={`w-full p-3 border rounded-lg ${theme === 'light' ? 'bg-white' : 'bg-gray-700'} border-gray-300`}
            rows="4"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={generateInsights}
            className="mt-4 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition duration-200"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </span>
            ) : 'Generate Insights'}
          </motion.button>
        </motion.section>

        {/* Results Dashboard */}
        <AnimatePresence>
          {insights && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`${theme === 'light' ? 'bg-white text-gray-800' : 'bg-gray-800 text-white'} rounded-lg shadow-lg p-6 mb-6`}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-poppins font-semibold">Results Dashboard</h2>
                <div className="flex space-x-2">
                  {user && (
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={saveInsight}
                      className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <Save size={20} className="mr-2" /> Save Insight
                    </motion.button>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    onClick={exportPDF}
                    className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    <Download size={20} className="mr-2" /> Export PDF
                  </motion.button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-poppins font-medium mb-2">Insights</h3>
                  {Object.entries(insights.swot).map(([key, values]) => (
                    <div key={key} className="mb-4">
                      <h4 className="font-semibold">{key}</h4>
                      {values.length > 0 ? (
                        <ul className="list-disc pl-5">
                          {values.map((item, i) => (
                            <li key={i} className="text-sm">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-500">No {key.toLowerCase()} identified</p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-8">
                  <div className="h-[300px] flex flex-col items-center" ref={barChartRef}>
                    <h4 className="text-sm font-medium mb-2">SWOT Analysis Bar Chart</h4>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={insights.chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip 
                          contentStyle={{
                            backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
                            borderColor: theme === 'dark' ? '#374151' : '#e5e7eb'
                          }}
                        />
                        <Bar dataKey="value" fill="#4f46e5" radius={[4, 4, 0, 0]}>
                          {insights.chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="h-[350px] flex flex-col items-center" ref={pieChartRef}>
                    <h4 className="text-sm font-medium mb-2">SWOT Distribution</h4>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={insights.chartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          innerRadius={60}
                          paddingAngle={5}
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {insights.chartData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={COLORS[index % COLORS.length]} 
                              stroke={theme === 'dark' ? '#1f2937' : '#ffffff'}
                              strokeWidth={2}
                            />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value) => [`${value} points`, 'Score']}
                          contentStyle={{
                            backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
                            borderColor: theme === 'dark' ? '#374151' : '#e5e7eb'
                          }}
                        />
                        <Legend 
                          layout="horizontal" 
                          verticalAlign="bottom" 
                          align="center"
                          wrapperStyle={{
                            paddingTop: '20px'
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Saved Insights */}
        {user && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`${theme === 'light' ? 'bg-white text-gray-800' : 'bg-gray-800 text-white'} rounded-lg shadow-lg p-6`}
          >
            <h2 className="text-2xl font-poppins font-semibold mb-4">Saved Insights</h2>
            {savedInsights.length === 0 ? (
              <p className="text-sm text-gray-500">No saved insights yet.</p>
            ) : (
              <div className="space-y-4">
                {savedInsights.map((insight) => (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-4 rounded-lg ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-700'} flex justify-between items-center`}
                  >
                    <div 
                      className="flex-1 cursor-pointer" 
                      onClick={() => loadInsight(insight)}
                    >
                      <h3 className="font-semibold">{insight.insightType}</h3>
                      <p className={`text-sm ${theme === 'light' ? 'text-gray-600' : 'text-gray-300'}`}>{insight.input}</p>
                      <p className={`text-xs ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
                        {insight.timestamp.toLocaleString()}
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={() => deleteInsight(insight.id)}
                      className="p-2 text-red-600 hover:text-red-700"
                    >
                      <Trash2 size={20} />
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.section>
        )}
      </main>
    </div>
  );
};

export default App;
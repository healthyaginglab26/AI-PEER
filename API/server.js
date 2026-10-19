
//server.js serves as the main() like in other languages
//basically ties everything together to function in the backend

//loads .env specific from user account
require('dotenv').config();


const express=require('express');
const cors=require('cors');
const verification=require('./middleware/authMiddleware');
const requestLogger=require('./middleware/requestLogger');


const authRoutes = require('./routes/authRoutes');




const app=express();



//cors (cross origin resource sharing)
//json parser to convert text to objects
app.use(cors());
app.use(express.json());

// mounted above the routes so every hit (auth + protected + /health) lands
// in Cloud Logging with uid / method / path / status / duration
app.use(requestLogger);

app.get('/health',(req,res)=>{
    res.json({status:'OK',message:'AI PEER API is running'});
});

app.use('/auth', authRoutes);

// Mock assets for zero-credential local development (MP4 videos & GGUF stub)
const path = require('path');
const ALLOWED_MOCK_ASSETS = new Set([
    'sample-exercise.mp4',
    'dummy-qwen.gguf'
]);

app.get('/mock-assets/:filename', (req, res) => {
    if (process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE) {
        return res.status(404).json({ error: 'Not Found' });
    }
    const filename = path.basename(req.params.filename);
    if (!ALLOWED_MOCK_ASSETS.has(filename)) {
        return res.status(403).json({ error: 'Access denied: Asset not whitelisted' });
    }
    const assetPath = path.join(__dirname, 'mock-assets', filename);
    res.sendFile(assetPath);
});

app.use(verification);


//handles get request
//health is the URL path
//req what client sends
//response is what you send back

const videoRoutes = require('./routes/videosRoutes');
app.use("/video", videoRoutes);

const modelRoutes = require('./routes/modelRoutes');
app.use("/model", modelRoutes);

// Routes
const userRoutes = require("./routes/userRoutes");
app.use("/users", userRoutes);

const activitiesRoutes = require('./routes/activitiesRoutes');
app.use("/activities", activitiesRoutes);



const PORT=process.env.PORT||3000;


//app listens at this port
app.listen(PORT, ()=>{
    console.log('Server running!')
});


//routes holds all the video scripts to access them
